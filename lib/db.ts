import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EVENT_FIELDS, type EventDetails, type FestEvent } from "./event-fields";

// Column names only ever come from the fixed EVENT_FIELDS list; values are always bound parameters.
const COLUMNS = EVENT_FIELDS.join(", ");
const PLACEHOLDERS = EVENT_FIELDS.map(() => "?").join(", ");
const ASSIGNMENTS = EVENT_FIELDS.map((field) => `${field} = ?`).join(", ");

let database: DatabaseSync | undefined;

function db() {
  if (!database) {
    const file = process.env.DB_FILE || path.join(process.cwd(), "data", "fest.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    database = new DatabaseSync(file);
    const columnDefinitions = EVENT_FIELDS.map((field) => `${field} TEXT NOT NULL DEFAULT ''`).join(", ");
    database.exec(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ${columnDefinitions})`);
  }
  return database;
}

export function listEvents() {
  const rows = db().prepare(`SELECT id, ${COLUMNS} FROM events ORDER BY date, start_time, name`).all();
  return rows as unknown as FestEvent[];
}

export function createEvent(details: EventDetails): FestEvent {
  const id = randomUUID();
  db()
    .prepare(`INSERT INTO events (id, ${COLUMNS}) VALUES (?, ${PLACEHOLDERS})`)
    .run(id, ...EVENT_FIELDS.map((field) => details[field]));
  return { id, ...details };
}

export function updateEvent(id: string, details: EventDetails): FestEvent | null {
  const result = db()
    .prepare(`UPDATE events SET ${ASSIGNMENTS} WHERE id = ?`)
    .run(...EVENT_FIELDS.map((field) => details[field]), id);
  return result.changes === 0 ? null : { id, ...details };
}

export function deleteEvent(id: string) {
  return db().prepare("DELETE FROM events WHERE id = ?").run(id).changes > 0;
}
