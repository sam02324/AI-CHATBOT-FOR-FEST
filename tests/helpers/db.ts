import { afterAll, beforeEach } from "vitest";
import { closeDb, createEvent, db } from "@/lib/db";
import { EMPTY_EVENT, type EventDetails } from "@/lib/event-fields";
import type { ChatMessage, TicketStatus } from "@/lib/roles";
import { createTicket } from "@/lib/tickets";
import { assertLocalDatabase } from "./local";

// Queries here share the app's connection. Every connection to the socket server shares one Postgres
// session and has its protocol messages queued one by one, so a second connection could interleave.
export async function clearTables() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const rows = await db()`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`;
  await db().unsafe(`TRUNCATE ${rows.map((row) => row.tablename).join(", ")} RESTART IDENTITY CASCADE`);
}

export function useTestDatabase() {
  beforeEach(clearTables);
  afterAll(closeDb);
}

export function seedEvent(details: Partial<EventDetails> = {}) {
  return createEvent({ ...EMPTY_EVENT, name: "Hackathon", ...details });
}

export async function seedConversation(id: string, userId: string, messages: ChatMessage[], title = "A saved chat") {
  await db()`INSERT INTO conversations (id, user_id, title) VALUES (${id}, ${userId}, ${title})`;
  for (const message of messages) {
    await db()`INSERT INTO chat_messages (conversation_id, role, content) VALUES (${id}, ${message.role}, ${message.content})`;
  }
}

// Pairs of question and answer, numbered so tests can see which ones the AI was sent.
export function exchanges(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => [
    { role: "user" as const, content: `question ${index + 1}` },
    { role: "assistant" as const, content: `answer ${index + 1}` },
  ]).flat();
}

type TicketOptions = {
  userId?: string;
  description?: string;
  live?: boolean;
  status?: TicketStatus;
  // Seconds before now, for tests that depend on the order tickets were raised in.
  ageSeconds?: number;
  transcript?: ChatMessage[];
};

export async function seedTicket(options: TicketOptions = {}) {
  const { id } = await createTicket({
    userId: options.userId ?? "user_attendant",
    userName: "Test Person",
    userEmail: "person@example.com",
    description: options.description ?? "I need help",
    live: options.live ?? false,
    transcript: options.transcript,
  });
  if (options.status) await db()`UPDATE tickets SET status = ${options.status} WHERE id = ${id}`;
  if (options.ageSeconds) {
    await db().unsafe(`UPDATE tickets SET created_at = now() - interval '${options.ageSeconds} seconds' WHERE id = $1`, [id]);
  }
  return id;
}

export async function loggedErrors() {
  return db()`SELECT source, message, stack, digest, path FROM error_log ORDER BY id`;
}

export async function savedMessages(conversationId: string) {
  return db()`SELECT role, content FROM chat_messages WHERE conversation_id = ${conversationId} ORDER BY id`;
}

type Table = "conversations" | "chat_messages" | "tickets" | "ticket_messages" | "error_log" | "events";

export async function countRows(table: Table) {
  const rows = await db().unsafe(`SELECT count(*)::int AS total FROM ${table}`);
  return rows[0].total as number;
}
