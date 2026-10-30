import { jsonError, readJson } from "@/lib/api";
import { denyUnlessStaff, getUserId } from "@/lib/auth";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/roles";
import { updateTicketStatus } from "@/lib/tickets";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const { status } = ((await readJson(request)) ?? {}) as { status?: unknown };
  if (!TICKET_STATUSES.includes(status as TicketStatus)) return jsonError("Choose a valid status.", 400);

  const ticket = await updateTicketStatus((await params).id, status as TicketStatus, (await getUserId()) ?? "");
  return ticket ? Response.json(ticket) : jsonError("Ticket not found.", 404);
}
