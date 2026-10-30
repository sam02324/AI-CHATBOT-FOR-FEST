import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { EVENT_FIELDS, type EventDetails, type FestEvent } from "./event-fields";

// Column names only ever come from the fixed EVENT_FIELDS list; values are always bound parameters.
const COLUMNS = EVENT_FIELDS.join(", ");
const PLACEHOLDERS = EVENT_FIELDS.map(() => "?").join(", ");
const ASSIGNMENTS = EVENT_FIELDS.map((field) => `${field} = ?`).join(", ");

let database: Promise<Client> | undefined;

// Uses Turso when TURSO_DATABASE_URL is set, otherwise a local SQLite file for development.
function connect() {
  let url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    const file = process.env.DB_FILE || path.join(process.cwd(), "data", "fest.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    url = `file:${file}`;
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const columnDefinitions = EVENT_FIELDS.map((field) => `${field} TEXT NOT NULL DEFAULT ''`).join(", ");
  return client
    .execute(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ${columnDefinitions})`)
    .then(() => client);
}

function db() {
  database ??= connect().catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

function values(details: EventDetails) {
  return EVENT_FIELDS.map((field) => details[field]);
}

export async function listEvents() {
  const client = await db();
  const { rows } = await client.execute(`SELECT id, ${COLUMNS} FROM events ORDER BY date, start_time, name`);
  return rows.map((row) => ({ ...row })) as unknown as FestEvent[];
}

export async function createEvent(details: EventDetails): Promise<FestEvent> {
  const client = await db();
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO events (id, ${COLUMNS}) VALUES (?, ${PLACEHOLDERS})`,
    args: [id, ...values(details)],
  });
  return { id, ...details };
}

export async function updateEvent(id: string, details: EventDetails): Promise<FestEvent | null> {
  const client = await db();
  const result = await client.execute({
    sql: `UPDATE events SET ${ASSIGNMENTS} WHERE id = ?`,
    args: [...values(details), id],
  });
  return result.rowsAffected === 0 ? null : { id, ...details };
}

export async function deleteEvent(id: string) {
  const client = await db();
  const result = await client.execute({ sql: "DELETE FROM events WHERE id = ?", args: [id] });
  return result.rowsAffected > 0;
}
