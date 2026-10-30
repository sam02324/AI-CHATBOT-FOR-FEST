import { jsonError, readJson } from "@/lib/api";
import { denyUnlessStaff, getUserId } from "@/lib/auth";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/roles";
import { updateTicket } from "@/lib/tickets";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const { status, response } = ((await readJson(request)) ?? {}) as { status?: unknown; response?: unknown };
  if (!TICKET_STATUSES.includes(status as TicketStatus)) return jsonError("Choose a valid status.", 400);
  const cleanResponse = typeof response === "string" ? response.trim().slice(0, 2000) : "";

  const staffId = (await getUserId()) ?? "";
  const ticket = await updateTicket((await params).id, status as TicketStatus, cleanResponse, staffId);
  return ticket ? Response.json(ticket) : jsonError("Ticket not found.", 404);
}
