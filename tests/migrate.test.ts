import { readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../scripts/migrate.mjs";

// These use their own database, which is emptied before each test, so they never touch the one
// the other tests use.

const MIGRATIONS = readdirSync(path.join(process.cwd(), "db", "migrations")).sort();

const NEW_TICKET_COLUMNS = ["resolved_by", "resolved_at", "transcript", "transcript_count"];

// How the database looked before db/migrations existed, including some real rows.
const OLD_SCHEMA = `
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    venue TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    organiser TEXT NOT NULL DEFAULT '',
    coordinator_contact TEXT NOT NULL DEFAULT '',
    registration_link TEXT NOT NULL DEFAULT '',
    fee TEXT NOT NULL DEFAULT '',
    eligibility TEXT NOT NULL DEFAULT '',
    team_size TEXT NOT NULL DEFAULT '',
    prizes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    response TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  INSERT INTO events (id, name, venue) VALUES ('event-1', 'Old hackathon', 'Old hall'), ('event-2', 'Old quiz', '');
  INSERT INTO tickets (id, user_id, user_name, user_email, subject, description, status, response)
  VALUES
    ('TKT-OLD1', 'user_1', 'Old Name', 'old@example.com', 'Old subject', 'Old description', 'open', ''),
    ('TKT-OLD2', 'user_2', 'Other Name', 'other@example.com', 'Other', 'Other description', 'resolved', 'We fixed it');
`;

let engine: PGlite;
let server: PGLiteSocketServer;
let sql: postgres.Sql;

beforeAll(async () => {
  engine = await PGlite.create();
  server = new PGLiteSocketServer({ db: engine, host: "127.0.0.1", port: 0 });
  await server.start();
  sql = postgres(`postgres://postgres:postgres@${server.getServerConn()}/postgres`, {
    max: 1,
    prepare: false,
    ssl: false,
    onnotice: () => {},
  });
});

afterAll(async () => {
  await sql.end();
  await server.stop();
  await engine.close();
});

beforeEach(async () => {
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});

async function tables() {
  const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  return rows.map((row) => row.tablename as string);
}

async function columns(table: string) {
  const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`;
  return rows.map((row) => row.column_name as string);
}

describe("on an empty database", () => {
  test("creates every table", async () => {
    expect(await migrate(sql)).toEqual(MIGRATIONS);
    expect(await tables()).toEqual([
      "chat_messages",
      "conversations",
      "error_log",
      "events",
      "rate_limits",
      "schema_migrations",
      "staff_presence",
      "ticket_messages",
      "tickets",
    ]);
  });

  test("records each file it applied", async () => {
    await migrate(sql);
    const rows = await sql`SELECT version FROM schema_migrations ORDER BY version`;
    expect(rows.map((row) => row.version)).toEqual(MIGRATIONS);
  });

  test("a second run applies nothing", async () => {
    await migrate(sql);
    const before = await sql`SELECT version, applied_at FROM schema_migrations ORDER BY version`;

    expect(await migrate(sql)).toEqual([]);

    const after = await sql`SELECT version, applied_at FROM schema_migrations ORDER BY version`;
    expect(after).toEqual(before);
  });

  test("creates the indexes the queries depend on", async () => {
    await migrate(sql);
    const rows = await sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = rows.map((row) => row.indexname);
    for (const index of [
      "conversations_user",
      "chat_messages_conversation",
      "tickets_user",
      "tickets_status_created",
      "ticket_messages_ticket",
      "rate_limits_window",
      "error_log_created",
    ]) {
      expect(names).toContain(index);
    }
  });

  test("deleting a chat or a ticket deletes its messages", async () => {
    await migrate(sql);
    await sql`INSERT INTO conversations (id, user_id, title) VALUES ('c', 'u', 't')`;
    await sql`INSERT INTO chat_messages (conversation_id, role, content) VALUES ('c', 'user', 'hi')`;
    await sql`INSERT INTO tickets (id, user_id, user_name, user_email, subject, description) VALUES ('t', 'u', 'n', 'e', 's', 'd')`;
    await sql`INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, content) VALUES ('t', 'staff', 'n', 'hi')`;

    await sql`DELETE FROM conversations`;
    await sql`DELETE FROM tickets`;

    expect(await sql`SELECT 1 FROM chat_messages`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM ticket_messages`).toHaveLength(0);
  });

  test("a message can't point at a chat or ticket that doesn't exist", async () => {
    await migrate(sql);
    await expect(sql`INSERT INTO chat_messages (conversation_id, role, content) VALUES ('none', 'user', 'hi')`).rejects.toThrow();
    await expect(sql`INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, content) VALUES ('none', 'staff', 'n', 'hi')`).rejects.toThrow();
  });
});

describe("on a database from before migrations", () => {
  beforeEach(async () => {
    await sql.unsafe(OLD_SCHEMA);
  });

  test("the starting point really is missing the new columns", async () => {
    const before = await columns("tickets");
    for (const column of [...NEW_TICKET_COLUMNS, "live"]) expect(before).not.toContain(column);
    expect(await columns("events")).not.toContain("custom_sections");
  });

  test("adds everything", async () => {
    expect(await migrate(sql)).toEqual(MIGRATIONS);

    const after = await columns("tickets");
    for (const column of [...NEW_TICKET_COLUMNS, "live"]) expect(after).toContain(column);
    expect(await columns("events")).toContain("custom_sections");
    for (const table of ["conversations", "chat_messages", "ticket_messages", "staff_presence", "rate_limits", "error_log"]) {
      expect(await tables()).toContain(table);
    }
  });

  test("keeps the existing rows, and gives them sensible defaults", async () => {
    await migrate(sql);

    expect(await sql`SELECT id, name, venue, custom_sections FROM events ORDER BY id`).toEqual([
      { id: "event-1", name: "Old hackathon", venue: "Old hall", custom_sections: "[]" },
      { id: "event-2", name: "Old quiz", venue: "", custom_sections: "[]" },
    ]);
    expect(
      await sql`
        SELECT id, user_name, description, status, response, live, resolved_by, resolved_at, transcript, transcript_count
        FROM tickets ORDER BY id`,
    ).toEqual([
      {
        id: "TKT-OLD1",
        user_name: "Old Name",
        description: "Old description",
        status: "open",
        response: "",
        live: false,
        resolved_by: "",
        resolved_at: null,
        transcript: "[]",
        transcript_count: 0,
      },
      {
        id: "TKT-OLD2",
        user_name: "Other Name",
        description: "Other description",
        status: "resolved",
        response: "We fixed it",
        live: false,
        resolved_by: "",
        resolved_at: null,
        transcript: "[]",
        transcript_count: 0,
      },
    ]);
  });

  test("a second run applies nothing and changes nothing", async () => {
    await migrate(sql);
    await sql`UPDATE tickets SET resolved_by = 'Someone' WHERE id = 'TKT-OLD2'`;

    expect(await migrate(sql)).toEqual([]);

    const [ticket] = await sql`SELECT resolved_by FROM tickets WHERE id = 'TKT-OLD2'`;
    expect(ticket.resolved_by).toBe("Someone");
    expect(await sql`SELECT 1 FROM tickets`).toHaveLength(2);
  });

  test("only runs the files that haven't run yet", async () => {
    await sql`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`INSERT INTO schema_migrations (version) VALUES (${MIGRATIONS[0]})`;

    expect(await migrate(sql)).toEqual(MIGRATIONS.slice(1));

    // The first file was marked as done, so what only it adds stays missing.
    const after = await columns("tickets");
    expect(after).not.toContain("live");
    expect(after).toContain("transcript");
  });
});

describe("when a migration fails", () => {
  // rate_limits already exists without window_start, so the second file's CREATE INDEX fails
  // after the first file and the second file's earlier statements have all run.
  beforeEach(async () => {
    await sql.unsafe(OLD_SCHEMA);
    await sql`CREATE TABLE rate_limits (key TEXT PRIMARY KEY)`;
  });

  test("the error comes through", async () => {
    await expect(migrate(sql)).rejects.toThrow(/window_start/);
  });

  test("nothing is left half applied", async () => {
    await migrate(sql).catch(() => {});

    expect(await tables()).toEqual(["events", "rate_limits", "tickets"]);
    const ticketColumns = await columns("tickets");
    for (const column of [...NEW_TICKET_COLUMNS, "live"]) expect(ticketColumns).not.toContain(column);
    expect(await columns("events")).not.toContain("custom_sections");
    expect(await sql`SELECT 1 FROM events`).toHaveLength(2);
    expect(await sql`SELECT 1 FROM tickets`).toHaveLength(2);
  });

  test("runs cleanly once the problem is fixed", async () => {
    await migrate(sql).catch(() => {});
    await sql`DROP TABLE rate_limits`;

    expect(await migrate(sql)).toEqual(MIGRATIONS);
    expect(await sql`SELECT 1 FROM tickets`).toHaveLength(2);
  });
});
