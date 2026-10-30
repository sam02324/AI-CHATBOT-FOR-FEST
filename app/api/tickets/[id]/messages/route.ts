import { currentUser } from "@clerk/nextjs/server";
import { jsonError, readJson } from "@/lib/api";
import { getRole, getUserId } from "@/lib/auth";
import { isStaff } from "@/lib/roles";
import { addTicketMessage, getTicketAccess, listTicketMessages } from "@/lib/tickets";

type Context = { params: Promise<{ id: string }> };

// Only the person who raised a ticket and staff can use its conversation.
// The owner check comes first because it needs no call to Clerk, and this route is polled.
export async function GET(_request: Request, { params }: Context) {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);

  const { id } = await params;
  const access = await getTicketAccess(id);
  if (!access) return jsonError("Ticket not found.", 404);
  const messages = await listTicketMessages(id);
  if (access.ownerId !== userId) {
    const role = await getRole();
    if (!role || !isStaff(role)) return jsonError("Ticket not found.", 404);
    return Response.json({ status: access.status, messages });
  }
  // Attendants see replies from "Fest team", so staff names aren't sent to them.
  const visible = messages.map((message) => (message.sender_role === "staff" ? { ...message, sender_name: "" } : message));
  return Response.json({ status: access.status, messages: visible });
}

export async function POST(request: Request, { params }: Context) {
  const user = await currentUser();
  if (!user) return jsonError("Please sign in.", 401);

  const { id } = await params;
  const access = await getTicketAccess(id);
  if (!access) return jsonError("Ticket not found.", 404);

  const role = await getRole();
  const staff = role !== null && isStaff(role);
  const owner = access.ownerId === user.id;
  if (!staff && !owner) return jsonError("Ticket not found.", 404);
  if (!staff && access.status === "resolved") return jsonError("This ticket is resolved.", 409);

  const { content } = ((await readJson(request)) ?? {}) as { content?: unknown };
  const clean = typeof content === "string" ? content.trim().slice(0, 2000) : "";
  if (!clean) return jsonError("Enter a message.", 400);

  // If staff raised this ticket themselves, their replies still count as the attendant's side.
  await addTicketMessage(id, owner ? "attendant" : "staff", user.fullName || user.username || "", clean);
  return new Response(null, { status: 201 });
}
