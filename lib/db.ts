import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { EVENT_FIELDS, type EventDetails, type FestEvent } from "./event-fields";

// Column names only ever come from this fixed list; values are always bound parameters.
const STORED_FIELDS = [...EVENT_FIELDS, "custom_sections"];
const COLUMNS = STORED_FIELDS.join(", ");
const PLACEHOLDERS = STORED_FIELDS.map((_, index) => `$${index + 2}`).join(", ");
const ASSIGNMENTS = STORED_FIELDS.map((field, index) => `${field} = $${index + 2}`).join(", ");

let database: postgres.Sql | undefined;

// Works with any Postgres connection string, including Neon and Supabase.
// The tables come from db/migrations, which run during deployment rather than on each cold start.
export function db() {
  if (!database) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    // One connection per serverless instance, and no prepared statements so connection poolers work.
    database = postgres(url, { max: 1, prepare: false, ssl: isLocal ? false : "require", onnotice: () => {} });
  }
  return database;
}

export async function closeDb() {
  await database?.end();
  database = undefined;
}

function values(details: EventDetails) {
  return [...EVENT_FIELDS.map((field) => details[field]), JSON.stringify(details.custom_sections)];
}

export async function listEvents() {
  const sql = db();
  const rows = await sql.unsafe(`SELECT id, ${COLUMNS} FROM events ORDER BY date, start_time, name, id`);
  return rows.map((row) => ({ ...row, custom_sections: JSON.parse(row.custom_sections) })) as unknown as FestEvent[];
}

export async function createEvent(details: EventDetails): Promise<FestEvent> {
  const sql = db();
  const id = randomUUID();
  await sql.unsafe(`INSERT INTO events (id, ${COLUMNS}) VALUES ($1, ${PLACEHOLDERS})`, [id, ...values(details)]);
  return { id, ...details };
}

export async function updateEvent(id: string, details: EventDetails): Promise<FestEvent | null> {
  const sql = db();
  const result = await sql.unsafe(`UPDATE events SET ${ASSIGNMENTS} WHERE id = $1`, [id, ...values(details)]);
  return result.count === 0 ? null : { id, ...details };
}

export async function deleteEvent(id: string) {
  const sql = db();
  const result = await sql.unsafe("DELETE FROM events WHERE id = $1", [id]);
  return result.count > 0;
}
