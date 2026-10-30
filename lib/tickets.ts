import { randomBytes } from "node:crypto";
import { db } from "./db";
import type { Ticket, TicketStatus } from "./roles";

// Leaves out letters and digits that are easy to confuse, such as O and 0.
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const COLUMNS = "id, user_name, user_email, subject, description, status, response, created_at, updated_at";

function newTicketId() {
  const code = [...randomBytes(8)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
  return `TKT-${code}`;
}

type NewTicket = { userId: string; userName: string; userEmail: string; subject: string; description: string };

export async function createTicket({ userId, userName, userEmail, subject, description }: NewTicket) {
  const sql = await db();
  const id = newTicketId();
  const rows = await sql.unsafe(
    `INSERT INTO tickets (id, user_id, user_name, user_email, subject, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [id, userId, userName, userEmail, subject, description],
  );
  return rows[0] as unknown as Ticket;
}

export async function countOpenTickets(userId: string) {
  const sql = await db();
  const rows = await sql`SELECT count(*)::int AS total FROM tickets WHERE user_id = ${userId} AND status <> 'resolved'`;
  return rows[0].total as number;
}

export async function listOwnTickets(userId: string) {
  const sql = await db();
  const rows = await sql.unsafe(`SELECT ${COLUMNS} FROM tickets WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return rows as unknown as Ticket[];
}

export async function listAllTickets() {
  const sql = await db();
  const rows = await sql.unsafe(
    `SELECT ${COLUMNS} FROM tickets
     ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`,
  );
  return rows as unknown as Ticket[];
}

export async function updateTicket(id: string, status: TicketStatus, response: string, staffId: string) {
  const sql = await db();
  const rows = await sql.unsafe(
    `UPDATE tickets SET status = $2, response = $3, updated_by = $4, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status, response, staffId],
  );
  return (rows[0] as unknown as Ticket) ?? null;
}
