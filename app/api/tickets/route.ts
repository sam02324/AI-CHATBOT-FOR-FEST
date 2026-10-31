import { currentUser } from "@clerk/nextjs/server";
import { cleanText, jsonError, readJson } from "@/lib/api";
import { getRole, getUserId } from "@/lib/auth";
import { parseAnswer } from "@/lib/chat-format";
import { getRecentMessages } from "@/lib/conversations";
import { enforceLimits, LIMITS } from "@/lib/rate-limit";
import { isStaff, TICKET_STATUSES, type ChatMessage, type TicketPage } from "@/lib/roles";
import {
  countOpenTickets,
  countTicketsByStatus,
  createTicket,
  isStaffOnline,
  listAllTickets,
  listOwnTickets,
} from "@/lib/tickets";

const MAX_OPEN_TICKETS = 10;
const TRANSCRIPT_MESSAGES = 20;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 500;

function pageSize(value: string | null) {
  const requested = Number.parseInt(value ?? "", 10);
  return Number.isNaN(requested) ? DEFAULT_PAGE_SIZE : Math.min(Math.max(requested, 1), MAX_PAGE_SIZE);
}

// Attendants get their own tickets. Staff can ask for every ticket, a page at a time, with ?scope=all.
// The staff list refreshes every few seconds, so this avoids currentUser(), which always calls Clerk.
export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);

  const query = new URL(request.url).searchParams;
  if (query.get("scope") !== "all") return Response.json(await listOwnTickets(userId));

  const role = await getRole();
  if (!role || !isStaff(role)) return jsonError("Only organisers and moderators can do this.", 403);

  const status = TICKET_STATUSES.find((option) => option === query.get("status"));
  const page: TicketPage = {
    tickets: await listAllTickets({ status, limit: pageSize(query.get("limit")) }),
    counts: await countTicketsByStatus(),
  };
  return Response.json(page);
}

// A copy of the chat for staff, so the person doesn't have to repeat themselves.
// It stays empty unless this person owns the conversation, so nobody can attach someone else's chat.
async function loadTranscript(conversationId: unknown, userId: string): Promise<ChatMessage[]> {
  if (typeof conversationId !== "string") return [];
  const messages = await getRecentMessages(conversationId, userId, TRANSCRIPT_MESSAGES);
  return messages
    .map(({ role, content }) => ({ role, content: parseAnswer(content).text }))
    .filter((message) => message.content);
}

// Raised from the chat. It's a live chat if staff are online, and otherwise a ticket they reply to later.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Please sign in.", 401);

  const { description, conversationId } = ((await readJson(request)) ?? {}) as {
    description?: unknown;
    conversationId?: unknown;
  };
  const cleanDescription = cleanText(description, 2000);
  if (!cleanDescription) return jsonError("Tell us what you need help with.", 400);

  const limited = await enforceLimits(user.id, LIMITS.ticket);
  if (limited) return limited;

  if ((await countOpenTickets(user.id)) >= MAX_OPEN_TICKETS) {
    return jsonError(`You have ${MAX_OPEN_TICKETS} unresolved tickets. Please wait for those to be resolved.`, 429);
  }

  const ticket = await createTicket({
    userId: user.id,
    userName: user.fullName || user.username || "",
    userEmail: user.primaryEmailAddress?.emailAddress ?? "",
    description: cleanDescription,
    live: await isStaffOnline(),
    transcript: await loadTranscript(conversationId, user.id),
  });
  return Response.json(ticket, { status: 201 });
}
