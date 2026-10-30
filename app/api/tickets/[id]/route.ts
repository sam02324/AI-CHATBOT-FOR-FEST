import { jsonError, readJson } from "@/lib/api";
import { denyUnlessStaff, getUserId } from "@/lib/auth";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/roles";
import { deleteTicket, updateTicketStatus } from "@/lib/tickets";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const { status } = ((await readJson(request)) ?? {}) as { status?: unknown };
  if (!TICKET_STATUSES.includes(status as TicketStatus)) return jsonError("Choose a valid status.", 400);

  const ticket = await updateTicketStatus((await params).id, status as TicketStatus, (await getUserId()) ?? "");
  return ticket ? Response.json(ticket) : jsonError("Ticket not found.", 404);
}

export async function DELETE(_request: Request, { params }: Context) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const deleted = await deleteTicket((await params).id);
  return deleted ? new Response(null, { status: 204 }) : jsonError("Ticket not found.", 404);
}
