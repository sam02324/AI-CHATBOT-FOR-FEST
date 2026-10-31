import { db } from "./db";

const MESSAGE_LENGTH = 1000;
const STACK_LENGTH = 4000;
const RETENTION_DAYS = 30;
const LIST_SIZE = 100;

export type ErrorDetails = { digest?: string; path?: string };
export type LoggedError = {
  id: string;
  source: string;
  message: string;
  stack: string;
  digest: string;
  path: string;
  created_at: string;
};

// Writes to the server logs and to the error_log table organisers can read.
// It never throws, so recording an error can't cause a second one.
export async function logError(source: string, error: unknown, details: ErrorDetails = {}) {
  console.error(`[${source}]`, error);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MESSAGE_LENGTH);
  const stack = (error instanceof Error ? (error.stack ?? "") : "").slice(0, STACK_LENGTH);
  try {
    const sql = db();
    await sql`
      INSERT INTO error_log (source, message, stack, digest, path)
      VALUES (${source}, ${message}, ${stack}, ${details.digest ?? ""}, ${details.path ?? ""})`;
    if (Math.random() < 0.02) {
      await sql.unsafe(`DELETE FROM error_log WHERE created_at < now() - interval '${RETENTION_DAYS} days'`);
    }
  } catch (failure) {
    console.error("Couldn't record that error", failure);
  }
}

export async function listRecentErrors() {
  const sql = db();
  const rows = await sql`
    SELECT id, source, message, stack, digest, path, created_at FROM error_log
    ORDER BY id DESC LIMIT ${LIST_SIZE}`;
  return rows as unknown as LoggedError[];
}
