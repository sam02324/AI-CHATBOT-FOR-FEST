import { randomBytes } from "node:crypto";
import { db, isStorable } from "./db";
import { TICKET_STATUSES, type ChatMessage, type Ticket, type TicketMessage, type TicketStatus } from "./roles";

// Leaves out letters and digits that are easy to confuse, such as O and 0.
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const COLUMNS = "id, user_name, user_email, subject, description, status, response, live, created_at, updated_at";
// Who resolved a ticket and how much chat came with it are only for staff, so attendants' queries
// leave these out. The chat itself is fetched separately, because the staff list refreshes often.
const STAFF_COLUMNS = `${COLUMNS}, resolved_by, resolved_at, transcript_count`;
const SUBJECT_LENGTH = 80;
// Staff count as online if their Tickets page checked in within this time.
const ONLINE_WINDOW_SECONDS = 45;

function newTicketId() {
  const code = [...randomBytes(8)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
  return `TKT-${code}`;
}

type NewTicket = {
  userId: string;
  userName: string;
  userEmail: string;
  description: string;
  live: boolean;
  transcript?: ChatMessage[];
};

export async function createTicket({ userId, userName, userEmail, description, live, transcript = [] }: NewTicket) {
  const sql = db();
  const id = newTicketId();
  const subject = description.split("\n")[0].slice(0, SUBJECT_LENGTH);
  const rows = await sql.unsafe(
    `INSERT INTO tickets (id, user_id, user_name, user_email, subject, description, live, transcript, transcript_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
    [id, userId, userName, userEmail, subject, description, live, JSON.stringify(transcript), transcript.length],
  );
  return rows[0] as unknown as Ticket;
}

export async function countOpenTickets(userId: string) {
  const sql = db();
  const rows = await sql`SELECT count(*)::int AS total FROM tickets WHERE user_id = ${userId} AND status <> 'resolved'`;
  return rows[0].total as number;
}

export async function listOwnTickets(userId: string) {
  const sql = db();
  const rows = await sql.unsafe(`SELECT ${COLUMNS} FROM tickets WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return rows as unknown as Ticket[];
}

// Live chats come first, then the rest by status, with the newest first in each group.
export async function listAllTickets({ status, limit }: { status?: TicketStatus; limit: number }) {
  const sql = db();
  const rows = await sql.unsafe(
    `SELECT ${STAFF_COLUMNS} FROM tickets ${status ? "WHERE status = $2" : ""}
     ORDER BY CASE WHEN status = 'resolved' THEN 3 WHEN live THEN 0 WHEN status = 'open' THEN 1 ELSE 2 END, created_at DESC
     LIMIT $1`,
    status ? [limit, status] : [limit],
  );
  return rows as unknown as Ticket[];
}

export async function countTicketsByStatus() {
  const sql = db();
  const rows = await sql`SELECT status, count(*)::int AS total FROM tickets GROUP BY status`;
  const totals = new Map(rows.map((row) => [row.status as string, row.total as number]));
  return Object.fromEntries(TICKET_STATUSES.map((status) => [status, totals.get(status) ?? 0])) as Record<TicketStatus, number>;
}

// The chat a ticket came from, or null if the ticket doesn't exist.
export async function getTicketTranscript(id: string) {
  if (!isStorable(id)) return null;
  const sql = db();
  const rows = await sql`SELECT transcript FROM tickets WHERE id = ${id}`;
  return rows.length === 0 ? null : (JSON.parse(rows[0].transcript) as ChatMessage[]);
}

// Records who resolved a ticket, and clears that if it's reopened.
export async function updateTicketStatus(id: string, status: TicketStatus, staffId: string, staffName: string) {
  if (!isStorable(id)) return null;
  const sql = db();
  const rows = await sql.unsafe(
    `UPDATE tickets SET
       status = $2::text,
       updated_by = $3,
       updated_at = now(),
       resolved_by = CASE WHEN $2::text = 'resolved' THEN $4::text ELSE '' END,
       resolved_at = CASE WHEN $2::text = 'resolved' THEN now() ELSE NULL END
     WHERE id = $1 RETURNING ${STAFF_COLUMNS}`,
    [id, status, staffId, staffName],
  );
  return (rows[0] as unknown as Ticket) ?? null;
}

// The ticket's messages are deleted with it.
export async function deleteTicket(id: string) {
  if (!isStorable(id)) return false;
  const sql = db();
  const result = await sql`DELETE FROM tickets WHERE id = ${id}`;
  return result.count > 0;
}

// Returns who owns a ticket and its status, or null if it doesn't exist.
export async function getTicketAccess(id: string) {
  if (!isStorable(id)) return null;
  const sql = db();
  const rows = await sql`SELECT user_id, status FROM tickets WHERE id = ${id}`;
  return rows.length === 0 ? null : { ownerId: rows[0].user_id as string, status: rows[0].status as TicketStatus };
}

export async function listTicketMessages(ticketId: string) {
  const sql = db();
  const rows = await sql`
    SELECT id, sender_role, sender_name, content, created_at FROM ticket_messages
    WHERE ticket_id = ${ticketId} ORDER BY id`;
  return rows as unknown as TicketMessage[];
}

export async function addTicketMessage(
  ticketId: string,
  senderRole: TicketMessage["sender_role"],
  senderName: string,
  content: string,
) {
  const sql = db();
  await sql`
    INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, content)
    VALUES (${ticketId}, ${senderRole}, ${senderName}, ${content})`;
  await sql`UPDATE tickets SET updated_at = now() WHERE id = ${ticketId}`;
}

export async function markStaffOnline(userId: string) {
  const sql = db();
  await sql`
    INSERT INTO staff_presence (user_id, last_seen) VALUES (${userId}, now())
    ON CONFLICT (user_id) DO UPDATE SET last_seen = now()`;
}

export async function isStaffOnline() {
  const sql = db();
  const rows = await sql.unsafe(
    `SELECT 1 FROM staff_presence WHERE last_seen > now() - interval '${ONLINE_WINDOW_SECONDS} seconds' LIMIT 1`,
  );
  return rows.length > 0;
}
