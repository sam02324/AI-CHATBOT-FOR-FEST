import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST as postChat } from "@/app/api/chat/route";
import { GET as getMessages, POST as postMessage } from "@/app/api/tickets/[id]/messages/route";
import { DELETE as deleteTicketRoute, PATCH } from "@/app/api/tickets/[id]/route";
import { GET as getTranscript } from "@/app/api/tickets/[id]/transcript/route";
import { GET as getTickets, POST as postTicket } from "@/app/api/tickets/route";
import { db } from "@/lib/db";
import type { Ticket, TicketMessage, TicketPage } from "@/lib/roles";
import { createTicket, markStaffOnline } from "@/lib/tickets";
import { resetAi } from "./helpers/ai";
import { countRows, exchanges, savedMessages, seedConversation, seedEvent, seedTicket, useTestDatabase } from "./helpers/db";
import { request, withId } from "./helpers/http";
import { knownBug } from "./helpers/known-bug";
import { signInAs, signOut, SOMEONE_ELSE } from "./helpers/people";

vi.mock("@/lib/claude", async (importOriginal) => {
  const { fakeClient } = await import("./helpers/ai");
  return { ...(await importOriginal<typeof import("@/lib/claude")>()), getClient: () => fakeClient };
});

useTestDatabase();

beforeEach(resetAi);

const STAFF_ONLY_FIELDS = ["resolved_by", "resolved_at", "transcript", "transcript_count"];
const NOT_FOR_ATTENDANTS = [...STAFF_ONLY_FIELDS, "user_id", "updated_by"];
const TICKET_ID = /^TKT-[23456789A-HJ-NP-Z]{8}$/;
// Halfway through a minute and an hour, so a fixed window can't roll over during a test.
const MID_WINDOW = Date.UTC(2026, 10, 14, 12, 30, 30);

function raiseTicket(body: unknown) {
  return postTicket(request("/api/tickets", "POST", body));
}

async function listAsStaff(query = "") {
  const response = await getTickets(request(`/api/tickets?scope=all${query}`));
  expect(response.status).toBe(200);
  return (await response.json()) as TicketPage;
}

async function listOwn() {
  const response = await getTickets(request("/api/tickets"));
  expect(response.status).toBe(200);
  return (await response.json()) as Ticket[];
}

function setStatus(id: string, status: string) {
  return PATCH(request(`/api/tickets/${id}`, "PATCH", { status }), withId(id));
}

function postTo(id: string, content: unknown) {
  return postMessage(request(`/api/tickets/${id}/messages`, "POST", { content }), withId(id));
}

async function readThread(id: string) {
  const response = await getMessages(request(`/api/tickets/${id}/messages`), withId(id));
  expect(response.status).toBe(200);
  return (await response.json()) as { status: string; messages: TicketMessage[] };
}

function expectNoStaffFields(ticket: object) {
  for (const field of NOT_FOR_ATTENDANTS) expect(ticket).not.toHaveProperty(field);
}

describe("ticket IDs", () => {
  test("look like TKT- and eight easy-to-read characters", async () => {
    signInAs("attendant");
    const response = await raiseTicket({ description: "Lost my bag" });
    const ticket = (await response.json()) as Ticket;
    expect(ticket.id).toMatch(TICKET_ID);
  });

  test("don't repeat", async () => {
    const created = await Promise.all(
      Array.from({ length: 50 }, () =>
        createTicket({ userId: "u", userName: "", userEmail: "", description: "d", live: false }),
      ),
    );
    expect(new Set(created.map((ticket) => ticket.id)).size).toBe(50);
    for (const ticket of created) expect(ticket.id).toMatch(TICKET_ID);
  });
});

describe("raising a ticket", () => {
  test("stores who raised it and returns it", async () => {
    signInAs("attendant", { id: "user_a", fullName: "Priya Rao", email: "priya@example.com" });
    const response = await raiseTicket({ description: "  Lost my bag near the stage\nIt's blue  " });

    expect(response.status).toBe(201);
    const ticket = (await response.json()) as Ticket;
    expect(ticket).toMatchObject({
      user_name: "Priya Rao",
      user_email: "priya@example.com",
      subject: "Lost my bag near the stage",
      description: "Lost my bag near the stage\nIt's blue",
      status: "open",
      live: false,
    });
    const rows = await db()`SELECT user_id FROM tickets WHERE id = ${ticket.id}`;
    expect(rows[0].user_id).toBe("user_a");
  });

  test("uses the username when there's no full name, and copes with neither name nor email", async () => {
    signInAs("attendant", { id: "user_b", fullName: null, username: "priya99", email: null });
    const first = (await (await raiseTicket({ description: "One" })).json()) as Ticket;
    expect(first).toMatchObject({ user_name: "priya99", user_email: "" });

    signInAs("attendant", { id: "user_c", fullName: null, username: null, email: null });
    const second = (await (await raiseTicket({ description: "Two" })).json()) as Ticket;
    expect(second).toMatchObject({ user_name: "", user_email: "" });
  });

  test("cuts a long subject and description", async () => {
    signInAs("attendant");
    const ticket = (await (await raiseTicket({ description: "x".repeat(3000) })).json()) as Ticket;
    expect(ticket.subject).toHaveLength(80);
    expect(ticket.description).toHaveLength(2000);
  });

  test.each([[{}], [{ description: "" }], [{ description: "   " }], [{ description: 5 }], [null]])(
    "rejects %j without creating anything",
    async (body) => {
      signInAs("attendant");
      const response = await raiseTicket(body);
      expect(response.status).toBe(400);
      expect(await countRows("tickets")).toBe(0);
    },
  );

  test("rejects a body that isn't JSON", async () => {
    signInAs("attendant");
    const response = await postTicket(new Request("http://localhost/api/tickets", { method: "POST", body: "{nope" }));
    expect(response.status).toBe(400);
  });

  test("is a live chat only while staff checked in recently", async () => {
    signInAs("attendant");
    const offline = (await (await raiseTicket({ description: "Nobody around" })).json()) as Ticket;
    expect(offline.live).toBe(false);

    await markStaffOnline("user_moderator");
    const online = (await (await raiseTicket({ description: "Someone around" })).json()) as Ticket;
    expect(online.live).toBe(true);

    await db()`UPDATE staff_presence SET last_seen = now() - interval '46 seconds'`;
    const stale = (await (await raiseTicket({ description: "Everyone left" })).json()) as Ticket;
    expect(stale.live).toBe(false);
  });
});

describe("unresolved ticket cap", () => {
  async function seedTickets(count: number, options: Parameters<typeof seedTicket>[0]) {
    for (let index = 0; index < count; index++) await seedTicket(options);
  }

  test("stops at 10 unresolved tickets", async () => {
    const { id: userId } = signInAs("attendant");
    await seedTickets(10, { userId });

    const response = await raiseTicket({ description: "One more" });

    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain("10 unresolved");
    expect(await countRows("tickets")).toBe(10);
  });

  test("allows the 10th", async () => {
    const { id: userId } = signInAs("attendant");
    await seedTickets(9, { userId });
    expect((await raiseTicket({ description: "Tenth" })).status).toBe(201);
  });

  test("counts tickets in progress, but not resolved ones or anyone else's", async () => {
    const { id: userId } = signInAs("attendant");
    await seedTickets(5, { userId, status: "in_progress" });
    await seedTickets(4, { userId });
    await seedTickets(3, { userId, status: "resolved" });
    await seedTickets(10, { userId: SOMEONE_ELSE });
    expect((await raiseTicket({ description: "Tenth unresolved" })).status).toBe(201);
    expect((await raiseTicket({ description: "Eleventh unresolved" })).status).toBe(429);
  });

  // It counts and then inserts in two steps, so requests sent together all see the same count.
  knownBug("BUG: requests sent together can't go past the cap", async () => {
    const { id: userId } = signInAs("attendant");
    await seedTickets(9, { userId });
    await Promise.all([1, 2, 3].map((number) => raiseTicket({ description: `At once ${number}` })));
    expect(await countRows("tickets")).toBe(10);
  });
});

describe("rate limits", () => {
  test("a sixth ticket within the hour gets 429 and a Retry-After", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MID_WINDOW);
    signInAs("attendant");
    for (let index = 0; index < 5; index++) {
      expect((await raiseTicket({ description: `Ticket ${index}` })).status).toBe(201);
    }

    const response = await raiseTicket({ description: "Sixth" });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1770");
    expect(await countRows("tickets")).toBe(5);
  });

  test("the ticket limit is per person", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MID_WINDOW);
    signInAs("attendant", { id: "user_one" });
    for (let index = 0; index < 6; index++) await raiseTicket({ description: "Mine" });
    signInAs("attendant", { id: "user_two" });
    expect((await raiseTicket({ description: "Mine too" })).status).toBe(201);
  });

  test("a 31st ticket message within the minute gets 429", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MID_WINDOW);
    const { id: userId } = signInAs("attendant");
    const id = await seedTicket({ userId });
    for (let index = 0; index < 30; index++) {
      expect((await postTo(id, `Message ${index}`)).status).toBe(201);
    }

    const response = await postTo(id, "One too many");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await countRows("ticket_messages")).toBe(30);
  });

  test("an empty ticket message doesn't use up the limit", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MID_WINDOW);
    const { id: userId } = signInAs("attendant");
    const id = await seedTicket({ userId });
    for (let index = 0; index < 40; index++) expect((await postTo(id, " ")).status).toBe(400);
    expect((await postTo(id, "A real message")).status).toBe(201);
  });
});

describe("what attendants see", () => {
  test("only their own tickets, newest first", async () => {
    const { id: userId } = signInAs("attendant");
    const older = await seedTicket({ userId, ageSeconds: 100 });
    const newer = await seedTicket({ userId, ageSeconds: 10 });
    await seedTicket({ userId: SOMEONE_ELSE });
    expect((await listOwn()).map((ticket) => ticket.id)).toEqual([newer, older]);
  });

  test("never the staff-only fields, even once a ticket is resolved and has a chat attached", async () => {
    const { id: userId } = signInAs("attendant");
    await seedConversation("chat-1", userId, exchanges(1));
    const created = await raiseTicket({ description: "Help", conversationId: "chat-1" });
    const ticket = (await created.json()) as Ticket;
    expectNoStaffFields(ticket);

    signInAs("moderator");
    await setStatus(ticket.id, "resolved");

    signInAs("attendant", { id: userId });
    const [listed] = await listOwn();
    expect(listed.id).toBe(ticket.id);
    expect(listed.status).toBe("resolved");
    expectNoStaffFields(listed);
    expect(JSON.stringify(listed)).not.toContain("question 1");
    expect(JSON.stringify(await readThread(ticket.id))).not.toContain("Name of user_moderator");
  });

  test("scope=all doesn't work for them", async () => {
    signInAs("attendant");
    expect((await getTickets(request("/api/tickets?scope=all"))).status).toBe(403);
  });

  test("staff asking without scope=all also get just their own", async () => {
    const { id: userId } = signInAs("moderator");
    const mine = await seedTicket({ userId });
    await seedTicket({ userId: SOMEONE_ELSE });
    const tickets = await listOwn();
    expect(tickets.map((ticket) => ticket.id)).toEqual([mine]);
    expectNoStaffFields(tickets[0]);
  });
});

describe("staff ticket list", () => {
  beforeEach(() => {
    signInAs("moderator");
  });

  test("has live chats first, then open, then in progress, then resolved, newest first within each", async () => {
    const resolvedLive = await seedTicket({ status: "resolved", live: true, ageSeconds: 1 });
    const resolvedOld = await seedTicket({ status: "resolved", ageSeconds: 500 });
    const inProgressOld = await seedTicket({ status: "in_progress", ageSeconds: 400 });
    const inProgressNew = await seedTicket({ status: "in_progress", ageSeconds: 40 });
    const openOld = await seedTicket({ ageSeconds: 300 });
    const openNew = await seedTicket({ ageSeconds: 30 });
    const liveOpen = await seedTicket({ live: true, ageSeconds: 200 });
    const liveInProgress = await seedTicket({ status: "in_progress", live: true, ageSeconds: 100 });

    const { tickets } = await listAsStaff();

    expect(tickets.map((ticket) => ticket.id)).toEqual([
      liveInProgress,
      liveOpen,
      openNew,
      openOld,
      inProgressNew,
      inProgressOld,
      resolvedLive,
      resolvedOld,
    ]);
  });

  test("filters by status, and ignores a status it doesn't know", async () => {
    const open = await seedTicket();
    const inProgress = await seedTicket({ status: "in_progress" });
    const resolved = await seedTicket({ status: "resolved" });

    expect((await listAsStaff("&status=open")).tickets.map((ticket) => ticket.id)).toEqual([open]);
    expect((await listAsStaff("&status=in_progress")).tickets.map((ticket) => ticket.id)).toEqual([inProgress]);
    expect((await listAsStaff("&status=resolved")).tickets.map((ticket) => ticket.id)).toEqual([resolved]);
    expect((await listAsStaff("&status=")).tickets).toHaveLength(3);
    expect((await listAsStaff("&status=closed")).tickets).toHaveLength(3);
    expect((await listAsStaff(`&status=${encodeURIComponent("open' OR '1'='1")}`)).tickets).toHaveLength(3);
  });

  test("counts come from the server and ignore the filter and the limit", async () => {
    await Promise.all([seedTicket(), seedTicket(), seedTicket()]);
    await seedTicket({ status: "in_progress" });
    const expected = { open: 3, in_progress: 1, resolved: 0 };

    expect((await listAsStaff()).counts).toEqual(expected);
    expect((await listAsStaff("&status=resolved")).counts).toEqual(expected);
    const limited = await listAsStaff("&limit=1");
    expect(limited.tickets).toHaveLength(1);
    expect(limited.counts).toEqual(expected);
  });

  test("uses the limit it's given, along with the filter", async () => {
    const newest = await seedTicket({ ageSeconds: 1 });
    await seedTicket({ ageSeconds: 2 });
    await seedTicket({ status: "resolved" });
    const { tickets } = await listAsStaff("&status=open&limit=1");
    expect(tickets.map((ticket) => ticket.id)).toEqual([newest]);
  });

  test("clamps the limit to between 1 and 500, and defaults to 30", async () => {
    await db().unsafe(`
      INSERT INTO tickets (id, user_id, user_name, user_email, subject, description)
      SELECT 'TKT-' || n, 'u', 'n', 'e', 's', 'd' FROM generate_series(1, 510) AS n`);

    expect((await listAsStaff()).tickets).toHaveLength(30);
    expect((await listAsStaff("&limit=abc")).tickets).toHaveLength(30);
    expect((await listAsStaff("&limit=")).tickets).toHaveLength(30);
    expect((await listAsStaff("&limit=0")).tickets).toHaveLength(1);
    expect((await listAsStaff("&limit=-5")).tickets).toHaveLength(1);
    expect((await listAsStaff("&limit=2.9")).tickets).toHaveLength(2);
    expect((await listAsStaff("&limit=500")).tickets).toHaveLength(500);
    expect((await listAsStaff("&limit=501")).tickets).toHaveLength(500);
    expect((await listAsStaff("&limit=99999999999")).tickets).toHaveLength(500);
  });

  test("includes who resolved it and how much chat there is, but not the chat itself", async () => {
    await seedTicket({ transcript: exchanges(2) });
    const [ticket] = (await listAsStaff()).tickets;
    expect(ticket).toMatchObject({ resolved_by: "", resolved_at: null, transcript_count: 4 });
    expect(ticket).not.toHaveProperty("transcript");
  });
});

describe("a ticket's conversation", () => {
  test("someone else's ticket reads as not found", async () => {
    signInAs("attendant");
    const id = await seedTicket({ userId: SOMEONE_ELSE });
    const response = await getMessages(request(`/api/tickets/${id}/messages`), withId(id));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Ticket not found." });
  });

  test("posting to someone else's ticket reads as not found and stores nothing", async () => {
    signInAs("attendant");
    const id = await seedTicket({ userId: SOMEONE_ELSE });
    expect((await postTo(id, "Let me in")).status).toBe(404);
    expect(await countRows("ticket_messages")).toBe(0);
  });

  test("a ticket that doesn't exist is 404 for staff too", async () => {
    signInAs("organiser");
    expect((await getMessages(request("/api/tickets/none/messages"), withId("none"))).status).toBe(404);
    expect((await postTo("none", "Hello")).status).toBe(404);
  });

  test("the owner and staff can talk to each other", async () => {
    const owner = signInAs("attendant", { id: "user_owner", fullName: "Priya" });
    const id = await seedTicket({ userId: owner.id });
    expect((await postTo(id, "  Any news?  ")).status).toBe(201);

    signInAs("moderator", { fullName: "Mod Person" });
    expect((await postTo(id, "Looking into it")).status).toBe(201);
    const staffView = await readThread(id);
    expect(staffView.messages.map(({ sender_role, sender_name, content }) => ({ sender_role, sender_name, content }))).toEqual([
      { sender_role: "attendant", sender_name: "Priya", content: "Any news?" },
      { sender_role: "staff", sender_name: "Mod Person", content: "Looking into it" },
    ]);
  });

  test("removes staff names for the ticket's owner, but keeps their own", async () => {
    const owner = signInAs("attendant", { id: "user_owner", fullName: "Priya" });
    const id = await seedTicket({ userId: owner.id });
    await postTo(id, "Any news?");
    signInAs("organiser", { fullName: "Secret Staff Name" });
    await postTo(id, "Looking into it");

    signInAs("attendant", { id: "user_owner", fullName: "Priya" });
    const thread = await readThread(id);

    expect(thread.messages.map(({ sender_role, sender_name }) => ({ sender_role, sender_name }))).toEqual([
      { sender_role: "attendant", sender_name: "Priya" },
      { sender_role: "staff", sender_name: "" },
    ]);
    expect(JSON.stringify(thread)).not.toContain("Secret Staff Name");
  });

  test("a staff member who raised a ticket is on the attendant's side of it", async () => {
    const owner = signInAs("moderator", { id: "user_mod" });
    const id = await seedTicket({ userId: owner.id });
    await postTo(id, "My own problem");
    const rows = await db()`SELECT sender_role FROM ticket_messages WHERE ticket_id = ${id}`;
    expect(rows[0].sender_role).toBe("attendant");
  });

  test("an attendant can't post to a resolved ticket, while staff can", async () => {
    const owner = signInAs("attendant");
    const id = await seedTicket({ userId: owner.id, status: "resolved" });

    const refused = await postTo(id, "One more thing");
    expect(refused.status).toBe(409);
    expect(await countRows("ticket_messages")).toBe(0);

    signInAs("moderator");
    expect((await postTo(id, "Staff can still write")).status).toBe(201);
    expect(await countRows("ticket_messages")).toBe(1);
    // Replying doesn't quietly reopen it.
    expect((await readThread(id)).status).toBe("resolved");
  });

  test("an attendant can post again once it's reopened", async () => {
    const owner = signInAs("attendant", { id: "user_owner" });
    const id = await seedTicket({ userId: owner.id, status: "resolved" });
    signInAs("moderator");
    await setStatus(id, "open");
    signInAs("attendant", { id: "user_owner" });
    expect((await postTo(id, "Thanks for reopening")).status).toBe(201);
  });

  test.each([[""], ["   "], [5], [null]])("rejects the message %j", async (content) => {
    const { id: userId } = signInAs("attendant");
    const id = await seedTicket({ userId });
    expect((await postTo(id, content)).status).toBe(400);
    expect(await countRows("ticket_messages")).toBe(0);
  });

  test("cuts a long message", async () => {
    const { id: userId } = signInAs("attendant");
    const id = await seedTicket({ userId });
    await postTo(id, "x".repeat(3000));
    const rows = await db()`SELECT length(content)::int AS length FROM ticket_messages`;
    expect(rows[0].length).toBe(2000);
  });

  test("a new message moves the ticket's updated time forward", async () => {
    const { id: userId } = signInAs("attendant");
    const id = await seedTicket({ userId });
    await db()`UPDATE tickets SET updated_at = now() - interval '1 hour' WHERE id = ${id}`;
    await postTo(id, "Hello");
    const rows = await db()`SELECT updated_at > now() - interval '1 minute' AS moved FROM tickets WHERE id = ${id}`;
    expect(rows[0].moved).toBe(true);
  });
});

describe("resolving and reopening", () => {
  test("resolving records who and when", async () => {
    const id = await seedTicket();
    signInAs("moderator", { id: "user_mod", fullName: "Mod Person" });

    const response = await setStatus(id, "resolved");

    expect(response.status).toBe(200);
    const ticket = (await response.json()) as Ticket;
    expect(ticket).toMatchObject({ id, status: "resolved", resolved_by: "Mod Person" });
    expect(Date.now() - new Date(ticket.resolved_at!).getTime()).toBeLessThan(60_000);
    const rows = await db()`SELECT updated_by FROM tickets WHERE id = ${id}`;
    expect(rows[0].updated_by).toBe("user_mod");
  });

  test.each([
    [{ fullName: null, username: "modname" }, "modname"],
    [{ fullName: null, username: null, email: "mod@example.com" }, "mod@example.com"],
    [{ fullName: null, username: null, email: null }, "Fest team"],
  ])("falls back through the person's details: %j", async (details, expected) => {
    const id = await seedTicket();
    signInAs("organiser", details);
    const ticket = (await (await setStatus(id, "resolved")).json()) as Ticket;
    expect(ticket.resolved_by).toBe(expected);
  });

  test.each(["open", "in_progress"])("changing to %s clears who resolved it", async (status) => {
    const id = await seedTicket();
    signInAs("organiser");
    await setStatus(id, "resolved");

    const ticket = (await (await setStatus(id, status)).json()) as Ticket;

    expect(ticket).toMatchObject({ status, resolved_by: "", resolved_at: null });
    const [row] = await db()`SELECT resolved_by, resolved_at FROM tickets WHERE id = ${id}`;
    expect(row).toMatchObject({ resolved_by: "", resolved_at: null });
  });

  test.each(["closed", "", null, 5, "RESOLVED"])("refuses the status %j", async (status) => {
    const id = await seedTicket();
    signInAs("organiser");
    expect((await setStatus(id, status as string)).status).toBe(400);
    const [row] = await db()`SELECT status FROM tickets WHERE id = ${id}`;
    expect(row.status).toBe("open");
  });

  test("a ticket that doesn't exist is 404", async () => {
    signInAs("organiser");
    expect((await setStatus("TKT-NONE", "resolved")).status).toBe(404);
  });
});

describe("deleting", () => {
  test("removes the ticket and its messages, and leaves other tickets alone", async () => {
    const id = await seedTicket();
    const other = await seedTicket();
    signInAs("moderator");
    await postTo(id, "First");
    await postTo(id, "Second");
    await postTo(other, "Keep me");

    const response = await deleteTicketRoute(request(`/api/tickets/${id}`, "DELETE"), withId(id));

    expect(response.status).toBe(204);
    const tickets = await db()`SELECT id FROM tickets`;
    expect(tickets.map((row) => row.id)).toEqual([other]);
    const messages = await db()`SELECT ticket_id, content FROM ticket_messages`;
    expect(messages).toEqual([{ ticket_id: other, content: "Keep me" }]);
  });

  test("deleting one that isn't there is 404", async () => {
    signInAs("moderator");
    const response = await deleteTicketRoute(request("/api/tickets/none", "DELETE"), withId("none"));
    expect(response.status).toBe(404);
  });
});

describe("the chat attached to a ticket", () => {
  async function transcriptOf(id: string) {
    signInAs("moderator");
    const response = await getTranscript(request(`/api/tickets/${id}/transcript`), withId(id));
    expect(response.status).toBe(200);
    return (await response.json()) as { role: string; content: string }[];
  }

  test("is attached when the conversation is theirs", async () => {
    const { id: userId } = signInAs("attendant");
    await seedConversation("chat-1", userId, exchanges(2));

    const ticket = (await (await raiseTicket({ description: "Help", conversationId: "chat-1" })).json()) as Ticket;

    expect(await transcriptOf(ticket.id)).toEqual(exchanges(2));
    const [row] = await db()`SELECT transcript_count FROM tickets WHERE id = ${ticket.id}`;
    expect(row.transcript_count).toBe(4);
  });

  test("is not attached when the conversation is someone else's", async () => {
    signInAs("attendant");
    await seedConversation("chat-theirs", SOMEONE_ELSE, [
      { role: "user", content: "My private question" },
      { role: "assistant", content: "A private answer" },
    ]);

    const response = await raiseTicket({ description: "Help", conversationId: "chat-theirs" });

    expect(response.status).toBe(201);
    const ticket = (await response.json()) as Ticket;
    expect(await transcriptOf(ticket.id)).toEqual([]);
    const [row] = await db()`SELECT transcript, transcript_count FROM tickets WHERE id = ${ticket.id}`;
    expect(row).toEqual({ transcript: "[]", transcript_count: 0 });
  });

  test.each([undefined, null, 5, {}, "no-such-chat", ""])("attaches nothing for the conversation ID %j", async (conversationId) => {
    signInAs("attendant");
    const ticket = (await (await raiseTicket({ description: "Help", conversationId })).json()) as Ticket;
    expect(await transcriptOf(ticket.id)).toEqual([]);
  });

  test("has the event markers taken out", async () => {
    const { id: userId } = signInAs("attendant");
    await seedConversation("chat-1", userId, [
      { role: "user", content: "What's on?" },
      { role: "assistant", content: "The hackathon is on Saturday.\n[[events: abc12345, def67890]]" },
      { role: "user", content: "Tell me more" },
      { role: "assistant", content: "[[events: abc12345]]" },
    ]);

    const ticket = (await (await raiseTicket({ description: "Help", conversationId: "chat-1" })).json()) as Ticket;

    const transcript = await transcriptOf(ticket.id);
    expect(transcript).toEqual([
      { role: "user", content: "What's on?" },
      { role: "assistant", content: "The hackathon is on Saturday." },
      { role: "user", content: "Tell me more" },
    ]);
    const [row] = await db()`SELECT transcript_count FROM tickets WHERE id = ${ticket.id}`;
    expect(row.transcript_count).toBe(3);
  });

  test("keeps the most recent 20 messages, starting on a person's message", async () => {
    const { id: userId } = signInAs("attendant");
    await seedConversation("chat-1", userId, exchanges(15));
    const ticket = (await (await raiseTicket({ description: "Help", conversationId: "chat-1" })).json()) as Ticket;
    const transcript = await transcriptOf(ticket.id);
    expect(transcript).toHaveLength(20);
    expect(transcript[0]).toEqual({ role: "user", content: "question 6" });
    expect(transcript.at(-1)).toEqual({ role: "assistant", content: "answer 15" });
  });

  test("a chat created through the real chat route can be attached", async () => {
    const { id: userId } = signInAs("attendant", { id: "user_real" });
    await seedEvent();
    const answer = await postChat(request("/api/chat", "POST", { message: "When is it?" }));
    await answer.text();
    const conversationId = answer.headers.get("X-Conversation-Id");

    const ticket = (await (await raiseTicket({ description: "Help", conversationId })).json()) as Ticket;

    expect(await transcriptOf(ticket.id)).toEqual([
      { role: "user", content: "When is it?" },
      { role: "assistant", content: "Hello there" },
    ]);
    expect(userId).toBe("user_real");
  });

  test("the response to the attendant has no transcript fields", async () => {
    const { id: userId } = signInAs("attendant");
    await seedConversation("chat-1", userId, exchanges(1));

    const body = await (await raiseTicket({ description: "Help", conversationId: "chat-1" })).json();

    expectNoStaffFields(body);
    expect(JSON.stringify(body)).not.toContain("question 1");
  });

  test("the transcript route is for staff only, and knows when a ticket is missing", async () => {
    const { id: userId } = signInAs("attendant");
    const id = await seedTicket({ userId, transcript: exchanges(1) });
    expect((await getTranscript(request(`/api/tickets/${id}/transcript`), withId(id))).status).toBe(403);

    signOut();
    expect((await getTranscript(request(`/api/tickets/${id}/transcript`), withId(id))).status).toBe(401);

    signInAs("organiser");
    expect((await getTranscript(request("/api/tickets/none/transcript"), withId("none"))).status).toBe(404);
  });
});

describe("tricky text", () => {
  const TRICKY = [
    "'); DROP TABLE tickets;--",
    "\"; DELETE FROM conversations; --",
    "Robert'); DROP TABLE chat_messages;--",
    "$1 $2 ${name} %s \\ \\n",
    "emoji 🎉 and हिन्दी",
    "<script>alert(1)</script>",
  ];

  test.each(TRICKY)("a ticket keeps %j as plain text", async (text) => {
    signInAs("attendant", { fullName: text, email: text });
    const ticket = (await (await raiseTicket({ description: text })).json()) as Ticket;
    expect(ticket).toMatchObject({ description: text, subject: text, user_name: text, user_email: text });
    await postTo(ticket.id, text);

    const [row] = await db()`SELECT description, user_name FROM tickets WHERE id = ${ticket.id}`;
    expect(row).toEqual({ description: text, user_name: text });
    const messages = await db()`SELECT content FROM ticket_messages WHERE ticket_id = ${ticket.id}`;
    expect(messages[0].content).toBe(text);
    expect(await countRows("tickets")).toBe(1);
  });

  test.each(TRICKY)("a chat keeps %j as plain text", async (text) => {
    signInAs("attendant");
    await seedEvent();
    const response = await postChat(request("/api/chat", "POST", { message: text }));
    await response.text();

    const id = response.headers.get("X-Conversation-Id")!;
    const saved = await savedMessages(id);
    expect(saved[0]).toEqual({ role: "user", content: text });
    const [conversation] = await db()`SELECT title FROM conversations WHERE id = ${id}`;
    expect(conversation.title).toBe(text);
    expect(await countRows("events")).toBe(1);
  });

  test("cutting text in the middle of an emoji doesn't stop it being saved", async () => {
    signInAs("attendant");
    const description = `x${"🎉".repeat(1100)}`;
    const ticket = (await (await raiseTicket({ description })).json()) as Ticket;
    expect(ticket.id).toMatch(TICKET_ID);

    const { id } = await postChat(request("/api/chat", "POST", { message: `x${"🎉".repeat(40)}` })).then(async (response) => {
      await response.text();
      return { id: response.headers.get("X-Conversation-Id")! };
    });
    expect(await savedMessages(id)).toHaveLength(2);
  });

  test("half of an emoji, which JSON allows, doesn't stop text being saved", async () => {
    signInAs("attendant");
    expect((await raiseTicket({ description: "half \ud83c" })).status).toBe(201);
  });

  test("an ID written like an attack just isn't found", async () => {
    await seedTicket();
    signInAs("organiser");
    const attack = "x' OR '1'='1";
    expect((await setStatus(attack, "resolved")).status).toBe(404);
    expect((await deleteTicketRoute(request("/api/tickets/x", "DELETE"), withId(attack))).status).toBe(404);
    expect((await getMessages(request("/api/tickets/x/messages"), withId(attack))).status).toBe(404);
    expect(await countRows("tickets")).toBe(1);
    const [row] = await db()`SELECT status FROM tickets`;
    expect(row.status).toBe("open");
  });

  test("a chat can't attach a transcript with a conversation ID written like an attack", async () => {
    const { id: userId } = signInAs("attendant");
    await seedConversation("chat-1", userId, exchanges(1));
    const attack = "x' OR '1'='1";
    const ticket = (await (await raiseTicket({ description: "Help", conversationId: attack })).json()) as Ticket;
    const [row] = await db()`SELECT transcript_count FROM tickets WHERE id = ${ticket.id}`;
    expect(row.transcript_count).toBe(0);
  });

  // Postgres can't store a NUL character in text, and these routes don't check for it.
  // In production these requests fail with a 500 instead of being cleaned or refused.
  describe("text containing a NUL character", () => {
    const NUL = "before\u0000after";

    knownBug("BUG: raising a ticket gives a clean response", async () => {
      signInAs("attendant");
      const response = await raiseTicket({ description: NUL });
      expect([201, 400]).toContain(response.status);
    });

    knownBug("BUG: posting a ticket message gives a clean response", async () => {
      const { id: userId } = signInAs("attendant");
      const id = await seedTicket({ userId });
      const response = await postTo(id, NUL);
      expect([201, 400]).toContain(response.status);
    });

    knownBug("BUG: reading a ticket with such an ID gives 404", async () => {
      signInAs("attendant");
      const response = await getMessages(request("/api/tickets/x/messages"), withId(NUL));
      expect(response.status).toBe(404);
    });
  });
});
