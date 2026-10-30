import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { EVENT_FIELDS, type EventDetails, type FestEvent } from "./event-fields";

// Column names only ever come from the fixed EVENT_FIELDS list; values are always bound parameters.
const COLUMNS = EVENT_FIELDS.join(", ");
const PLACEHOLDERS = EVENT_FIELDS.map((_, index) => `$${index + 2}`).join(", ");
const ASSIGNMENTS = EVENT_FIELDS.map((field, index) => `${field} = $${index + 2}`).join(", ");

let database: Promise<postgres.Sql> | undefined;

// Works with any Postgres connection string, including Neon and Supabase.
async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // One connection per serverless instance, and no prepared statements so connection poolers work.
  const sql = postgres(url, { max: 1, prepare: false, ssl: isLocal ? false : "require" });
  const columnDefinitions = EVENT_FIELDS.map((field) => `${field} TEXT NOT NULL DEFAULT ''`).join(", ");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ${columnDefinitions})`);
  return sql;
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
  const sql = await db();
  const rows = await sql.unsafe(`SELECT id, ${COLUMNS} FROM events ORDER BY date, start_time, name`);
  return rows.map((row) => ({ ...row })) as unknown as FestEvent[];
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
