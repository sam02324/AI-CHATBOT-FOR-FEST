import { currentUser } from "@clerk/nextjs/server";
import { jsonError, readJson } from "@/lib/api";
import { getRole } from "@/lib/auth";
import { isStaff } from "@/lib/roles";
import { countOpenTickets, createTicket, isStaffOnline, listAllTickets, listOwnTickets } from "@/lib/tickets";

const MAX_OPEN_TICKETS = 10;

// Attendants get their own tickets. Staff can ask for every ticket with ?scope=all.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Please sign in.", 401);

  if (new URL(request.url).searchParams.get("scope") === "all") {
    const role = await getRole();
    if (!role || !isStaff(role)) return jsonError("Only organisers and moderators can do this.", 403);
    return Response.json(await listAllTickets());
  }
  return Response.json(await listOwnTickets(user.id));
}

// Raised from the chat. It's a live chat if staff are online, and otherwise a ticket they reply to later.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Please sign in.", 401);

  const { description } = ((await readJson(request)) ?? {}) as { description?: unknown };
  const cleanDescription = typeof description === "string" ? description.trim().slice(0, 2000) : "";
  if (!cleanDescription) return jsonError("Tell us what you need help with.", 400);

  if ((await countOpenTickets(user.id)) >= MAX_OPEN_TICKETS) {
    return jsonError(`You have ${MAX_OPEN_TICKETS} unresolved tickets. Please wait for those to be resolved.`, 429);
  }

  const ticket = await createTicket({
    userId: user.id,
    userName: user.fullName || user.username || "",
    userEmail: user.primaryEmailAddress?.emailAddress ?? "",
    description: cleanDescription,
    live: await isStaffOnline(),
  });
  return Response.json(ticket, { status: 201 });
}
