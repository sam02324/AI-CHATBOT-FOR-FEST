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

// Postgres rejects text with a NUL character, so an ID containing one can't match anything.
export function isStorable(text: string) {
  return !text.includes("\0");
}

// Times are stored as printed, such as "9:00 AM". Anything else goes after them on the same day.
function minutesIntoDay(time: string) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(time.replaceAll(".", "").trim());
  if (!match) return 24 * 60;
  const hour = Number(match[1]) % (match[3] ? 12 : 24) + (match[3]?.toLowerCase() === "pm" ? 12 : 0);
  return hour * 60 + Number(match[2] ?? 0);
}

function byDateAndTime(a: FestEvent, b: FestEvent) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return minutesIntoDay(a.start_time) - minutesIntoDay(b.start_time);
}

function values(details: EventDetails) {
  return [...EVENT_FIELDS.map((field) => details[field]), JSON.stringify(details.custom_sections)];
}

export async function listEvents() {
  const sql = db();
  const rows = await sql.unsafe(`SELECT id, ${COLUMNS} FROM events ORDER BY date, start_time, name, id`);
  const events = rows.map((row) => ({ ...row, custom_sections: JSON.parse(row.custom_sections) })) as unknown as FestEvent[];
  // The sort keeps the query's order for ties, so the order never changes between requests. The prompt is cached.
  return events.sort(byDateAndTime);
}

export async function createEvent(details: EventDetails): Promise<FestEvent> {
  const sql = db();
  const id = randomUUID();
  await sql.unsafe(`INSERT INTO events (id, ${COLUMNS}) VALUES ($1, ${PLACEHOLDERS})`, [id, ...values(details)]);
  return { id, ...details };
}

export async function updateEvent(id: string, details: EventDetails): Promise<FestEvent | null> {
  if (!isStorable(id)) return null;
  const sql = db();
  const result = await sql.unsafe(`UPDATE events SET ${ASSIGNMENTS} WHERE id = $1`, [id, ...values(details)]);
  return result.count === 0 ? null : { id, ...details };
}

export async function deleteEvent(id: string) {
  if (!isStorable(id)) return false;
  const sql = db();
  const result = await sql.unsafe("DELETE FROM events WHERE id = $1", [id]);
  return result.count > 0;
}
