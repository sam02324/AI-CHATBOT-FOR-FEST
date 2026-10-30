import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { EVENT_FIELDS, type EventDetails, type FestEvent } from "./event-fields";

// Column names only ever come from this fixed list; values are always bound parameters.
const STORED_FIELDS = [...EVENT_FIELDS, "custom_sections"];
const COLUMNS = STORED_FIELDS.join(", ");
const PLACEHOLDERS = STORED_FIELDS.map((_, index) => `$${index + 2}`).join(", ");
const ASSIGNMENTS = STORED_FIELDS.map((field, index) => `${field} = $${index + 2}`).join(", ");

let database: Promise<postgres.Sql> | undefined;

// Works with any Postgres connection string, including Neon and Supabase.
async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // One connection per serverless instance, and no prepared statements so connection poolers work.
  const sql = postgres(url, { max: 1, prepare: false, ssl: isLocal ? false : "require", onnotice: () => {} });
  const columnDefinitions = EVENT_FIELDS.map((field) => `${field} TEXT NOT NULL DEFAULT ''`).join(", ");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ${columnDefinitions})`);
  // Adds the column to tables created before custom sections existed.
  await sql.unsafe("ALTER TABLE events ADD COLUMN IF NOT EXISTS custom_sections TEXT NOT NULL DEFAULT '[]'");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql.unsafe("CREATE INDEX IF NOT EXISTS conversations_user ON conversations (user_id, updated_at DESC)");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql.unsafe("CREATE INDEX IF NOT EXISTS chat_messages_conversation ON chat_messages (conversation_id, id)");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS tickets (
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
  )`);
  await sql.unsafe("CREATE INDEX IF NOT EXISTS tickets_user ON tickets (user_id, created_at DESC)");
  return sql;
}

export function db() {
  database ??= connect().catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

function values(details: EventDetails) {
  return [...EVENT_FIELDS.map((field) => details[field]), JSON.stringify(details.custom_sections)];
}

export async function listEvents() {
  const sql = await db();
  const rows = await sql.unsafe(`SELECT id, ${COLUMNS} FROM events ORDER BY date, start_time, name`);
  return rows.map((row) => ({ ...row, custom_sections: JSON.parse(row.custom_sections) })) as unknown as FestEvent[];
}

export async function createEvent(details: EventDetails): Promise<FestEvent> {
  const sql = await db();
  const id = randomUUID();
  await sql.unsafe(`INSERT INTO events (id, ${COLUMNS}) VALUES ($1, ${PLACEHOLDERS})`, [id, ...values(details)]);
  return { id, ...details };
}

export async function updateEvent(id: string, details: EventDetails): Promise<FestEvent | null> {
  const sql = await db();
  const result = await sql.unsafe(`UPDATE events SET ${ASSIGNMENTS} WHERE id = $1`, [id, ...values(details)]);
  return result.count === 0 ? null : { id, ...details };
}

export async function deleteEvent(id: string) {
  const sql = await db();
  const result = await sql.unsafe("DELETE FROM events WHERE id = $1", [id]);
  return result.count > 0;
}
