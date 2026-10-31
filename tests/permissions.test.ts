import { readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as chat from "@/app/api/chat/route";
import * as conversation from "@/app/api/conversations/[id]/route";
import * as conversations from "@/app/api/conversations/route";
import * as errors from "@/app/api/errors/route";
import * as eventCards from "@/app/api/events/cards/route";
import * as event from "@/app/api/events/[id]/route";
import * as events from "@/app/api/events/route";
import * as extract from "@/app/api/extract/route";
import * as presence from "@/app/api/presence/route";
import * as teamMember from "@/app/api/team/[id]/route";
import * as team from "@/app/api/team/route";
import * as ticketMessages from "@/app/api/tickets/[id]/messages/route";
import * as ticket from "@/app/api/tickets/[id]/route";
import * as ticketTranscript from "@/app/api/tickets/[id]/transcript/route";
import * as tickets from "@/app/api/tickets/route";
import ChatPage from "@/app/chat/page";
import OrganiserErrorsPage from "@/app/organiser/errors/page";
import OrganiserPage from "@/app/organiser/page";
import OrganiserTeamPage from "@/app/organiser/team/page";
import OrganiserTicketsPage from "@/app/organiser/tickets/page";
import HomePage from "@/app/page";
import MyTicketsPage from "@/app/tickets/page";
import { denyUnlessOrganiser, denyUnlessStaff, getRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Role } from "@/lib/roles";
import { fakeClient, resetAi } from "./helpers/ai";
import { seedConversation, seedEvent, seedTicket, useTestDatabase } from "./helpers/db";
import { request, withId } from "./helpers/http";
import { addPerson, clerkServer, clerkUsers, getPerson, signInAs, signOut, SOMEONE_ELSE } from "./helpers/people";

vi.mock("@/lib/claude", async (importOriginal) => {
  const { fakeClient } = await import("./helpers/ai");
  return { ...(await importOriginal<typeof import("@/lib/claude")>()), getClient: () => fakeClient };
});
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/Chat", () => ({ Chat: () => null }));
vi.mock("@/components/MyTickets", () => ({ MyTickets: () => null }));
vi.mock("@/components/OrganiserApp", () => ({ OrganiserApp: () => null }));
vi.mock("@/components/StaffTickets", () => ({ StaffTickets: () => null }));
vi.mock("@/components/TeamManager", () => ({ TeamManager: () => null }));

useTestDatabase();

beforeEach(resetAi);

const ROUTES = {
  "/api/chat": chat,
  "/api/conversations": conversations,
  "/api/conversations/[id]": conversation,
  "/api/errors": errors,
  "/api/events": events,
  "/api/events/[id]": event,
  "/api/events/cards": eventCards,
  "/api/extract": extract,
  "/api/presence": presence,
  "/api/team": team,
  "/api/team/[id]": teamMember,
  "/api/tickets": tickets,
  "/api/tickets/[id]": ticket,
  "/api/tickets/[id]/messages": ticketMessages,
  "/api/tickets/[id]/transcript": ticketTranscript,
};
type RoutePath = keyof typeof ROUTES;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const PEOPLE: Role[] = ["attendant", "moderator", "organiser"];

type Who = Role | "signedOut";
type Case = {
  route: RoutePath;
  method: string;
  note?: string;
  query?: string;
  // Prepares the data, given who's asking, and returns what the request needs.
  arrange?: (userId: string) => Promise<{ id?: string; body?: unknown }>;
  expected: Record<Who, number>;
};

function anyoneSignedIn(ok: number) {
  return { signedOut: 401, attendant: ok, moderator: ok, organiser: ok };
}
function staffOnly(ok: number) {
  return { signedOut: 401, attendant: 403, moderator: ok, organiser: ok };
}
function organiserOnly(ok: number) {
  return { signedOut: 401, attendant: 403, moderator: 403, organiser: ok };
}

const MINIMAL_EVENT = { name: "Robotics" };
const POSTER_BODY = { images: [{ data: "aGVsbG8=", mediaType: "image/png" }] };
const POSTER_RESULT = { is_event_poster: true, same_event: true, name: "Robotics", custom_sections: [], uncertain_fields: [] };

async function someoneElsesTicket() {
  return { id: await seedTicket({ userId: SOMEONE_ELSE }) };
}
async function ownTicket(userId: string) {
  return { id: await seedTicket({ userId }) };
}
async function ownChat(userId: string) {
  await seedConversation("chat-1", userId, [{ role: "user", content: "hi" }]);
  return { id: "chat-1" };
}
async function someoneElsesChat() {
  await seedConversation("chat-2", SOMEONE_ELSE, [{ role: "user", content: "secret" }]);
  return { id: "chat-2" };
}
async function existingEvent() {
  return { id: (await seedEvent()).id, body: MINIMAL_EVENT };
}
async function attendantToPromote() {
  addPerson("attendant", { id: "user_target" });
  return { id: "user_target", body: { role: "moderator" } };
}

const CASES: Case[] = [
  { route: "/api/chat", method: "POST", arrange: async () => ({ body: { message: "When is the hackathon?" } }), expected: anyoneSignedIn(200) },
  { route: "/api/conversations", method: "GET", expected: anyoneSignedIn(200) },
  { route: "/api/conversations/[id]", method: "GET", note: "their own chat", arrange: ownChat, expected: anyoneSignedIn(200) },
  {
    route: "/api/conversations/[id]",
    method: "GET",
    note: "someone else's chat",
    arrange: someoneElsesChat,
    expected: { signedOut: 401, attendant: 404, moderator: 404, organiser: 404 },
  },
  { route: "/api/conversations/[id]", method: "DELETE", note: "their own chat", arrange: ownChat, expected: anyoneSignedIn(204) },
  {
    route: "/api/conversations/[id]",
    method: "DELETE",
    note: "someone else's chat",
    arrange: someoneElsesChat,
    expected: { signedOut: 401, attendant: 404, moderator: 404, organiser: 404 },
  },
  { route: "/api/errors", method: "POST", arrange: async () => ({ body: { message: "Oops", path: "/chat" } }), expected: anyoneSignedIn(204) },
  { route: "/api/events", method: "GET", expected: staffOnly(200) },
  { route: "/api/events", method: "POST", arrange: async () => ({ body: MINIMAL_EVENT }), expected: staffOnly(201) },
  { route: "/api/events/[id]", method: "PUT", arrange: existingEvent, expected: staffOnly(200) },
  { route: "/api/events/[id]", method: "DELETE", arrange: existingEvent, expected: staffOnly(204) },
  { route: "/api/events/cards", method: "GET", expected: anyoneSignedIn(200) },
  { route: "/api/extract", method: "POST", arrange: async () => ({ body: POSTER_BODY }), expected: staffOnly(200) },
  { route: "/api/presence", method: "GET", expected: anyoneSignedIn(200) },
  { route: "/api/presence", method: "POST", expected: staffOnly(204) },
  { route: "/api/team", method: "GET", expected: organiserOnly(200) },
  { route: "/api/team/[id]", method: "PATCH", arrange: attendantToPromote, expected: organiserOnly(200) },
  { route: "/api/tickets", method: "GET", note: "their own tickets", expected: anyoneSignedIn(200) },
  { route: "/api/tickets", method: "GET", note: "every ticket", query: "?scope=all", expected: staffOnly(200) },
  { route: "/api/tickets", method: "POST", arrange: async () => ({ body: { description: "Lost my bag" } }), expected: anyoneSignedIn(201) },
  {
    route: "/api/tickets/[id]",
    method: "PATCH",
    note: "someone else's ticket",
    arrange: async () => ({ ...(await someoneElsesTicket()), body: { status: "resolved" } }),
    expected: staffOnly(200),
  },
  {
    route: "/api/tickets/[id]",
    method: "PATCH",
    note: "their own ticket",
    arrange: async (userId) => ({ ...(await ownTicket(userId)), body: { status: "resolved" } }),
    expected: staffOnly(200),
  },
  { route: "/api/tickets/[id]", method: "DELETE", note: "someone else's ticket", arrange: someoneElsesTicket, expected: staffOnly(204) },
  { route: "/api/tickets/[id]", method: "DELETE", note: "their own ticket", arrange: ownTicket, expected: staffOnly(204) },
  {
    route: "/api/tickets/[id]/messages",
    method: "GET",
    note: "someone else's ticket",
    arrange: someoneElsesTicket,
    expected: { signedOut: 401, attendant: 404, moderator: 200, organiser: 200 },
  },
  { route: "/api/tickets/[id]/messages", method: "GET", note: "their own ticket", arrange: ownTicket, expected: anyoneSignedIn(200) },
  {
    route: "/api/tickets/[id]/messages",
    method: "POST",
    note: "someone else's ticket",
    arrange: async () => ({ ...(await someoneElsesTicket()), body: { content: "Hello" } }),
    expected: { signedOut: 401, attendant: 404, moderator: 201, organiser: 201 },
  },
  {
    route: "/api/tickets/[id]/messages",
    method: "POST",
    note: "their own ticket",
    arrange: async (userId) => ({ ...(await ownTicket(userId)), body: { content: "Hello" } }),
    expected: anyoneSignedIn(201),
  },
  { route: "/api/tickets/[id]/transcript", method: "GET", note: "someone else's ticket", arrange: someoneElsesTicket, expected: staffOnly(200) },
  { route: "/api/tickets/[id]/transcript", method: "GET", note: "their own ticket", arrange: ownTicket, expected: staffOnly(200) },
];

function call(testCase: Case, id: string | undefined, init: { body?: unknown; rawBody?: string }) {
  const handler = (ROUTES[testCase.route] as unknown as Record<string, (...args: unknown[]) => Promise<Response>>)[testCase.method];
  const url = `http://localhost${testCase.route.replace("[id]", id ?? "x")}${testCase.query ?? ""}`;
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return handler(new Request(url, { method: testCase.method, body }), withId(id ?? "x"));
}

function caseName(testCase: Case) {
  return `${testCase.method} ${testCase.route}${testCase.note ? ` (${testCase.note})` : ""}`;
}

function signIn(who: Who, roleInToken: boolean) {
  if (who === "signedOut") return "nobody";
  return signInAs(who, { roleInToken }).id;
}

describe("the table of routes", () => {
  test("covers every route file under app/api", () => {
    const apiDir = path.join(process.cwd(), "app", "api");
    const files = readdirSync(apiDir, { recursive: true, encoding: "utf8" })
      .filter((file) => path.basename(file) === "route.ts")
      .map((file) => `/api/${path.dirname(file).split(path.sep).join("/")}`);
    expect(files.sort()).toEqual(Object.keys(ROUTES).sort());
  });

  test("covers every method each route exports", () => {
    const exported = Object.entries(ROUTES).flatMap(([route, module]) =>
      Object.keys(module)
        .filter((name) => HTTP_METHODS.includes(name))
        .map((method) => `${method} ${route}`),
    );
    const covered = new Set(CASES.map((testCase) => `${testCase.method} ${testCase.route}`));
    expect([...covered].sort()).toEqual(exported.sort());
  });
});

describe.each([
  { source: "the role comes from Clerk", roleInToken: false },
  { source: "the role comes from the login token", roleInToken: true },
])("every route when $source", ({ roleInToken }) => {
  describe.each(CASES.map((testCase) => [caseName(testCase), testCase] as const))("%s", (_name, testCase) => {
    test.each(["signedOut", ...PEOPLE] as Who[])("%s", async (who) => {
      // Poster reading and chat screening both use messages.parse. Only screening has a system prompt.
      fakeClient.messages.parse.mockImplementation(async (params) => ({
        stop_reason: "end_turn",
        parsed_output: params.system ? { category: "question" } : POSTER_RESULT,
      }));
      const userId = signIn(who, roleInToken);
      const { id, body } = (await testCase.arrange?.(userId)) ?? {};
      const response = await call(testCase, id, { body });
      expect(response.status).toBe(testCase.expected[who]);
      // A chat keeps saving until its answer has been read, which mustn't run into the next test.
      await response.text();
    });
  });
});

describe("denied requests", () => {
  const writes = CASES.filter((testCase) => testCase.method !== "GET");

  // Bad input must not be how someone finds out what a route does, or get them a different answer.
  test.each(writes.map((testCase) => [caseName(testCase), testCase] as const))("signed out, bad input: %s", async (_name, testCase) => {
    signOut();
    const { id } = (await testCase.arrange?.("nobody")) ?? {};
    const response = await call(testCase, id, { rawBody: testCase.method === "DELETE" ? undefined : "{not json" });
    expect(response.status).toBe(401);
  });

  test.each(writes.filter((testCase) => testCase.expected.attendant === 403).map((testCase) => [caseName(testCase), testCase] as const))(
    "attendant, bad input: %s",
    async (_name, testCase) => {
      const { id: userId } = signInAs("attendant");
      const { id } = (await testCase.arrange?.(userId)) ?? {};
      const response = await call(testCase, id, { rawBody: testCase.method === "DELETE" ? undefined : "{not json" });
      expect(response.status).toBe(403);
    },
  );

  test("an attendant's event changes and deletions don't happen", async () => {
    const saved = await seedEvent({ name: "Original" });
    signInAs("attendant");
    await event.PUT(request(`/api/events/${saved.id}`, "PUT", { name: "Changed" }), withId(saved.id));
    await events.POST(request("/api/events", "POST", { name: "New" }));
    await event.DELETE(request(`/api/events/${saved.id}`, "DELETE"), withId(saved.id));
    const rows = await db()`SELECT name FROM events`;
    expect(rows.map((row) => row.name)).toEqual(["Original"]);
  });

  test("an attendant can't resolve or delete even their own ticket", async () => {
    const { id: userId } = signInAs("attendant");
    const id = await seedTicket({ userId });
    await ticket.PATCH(request(`/api/tickets/${id}`, "PATCH", { status: "resolved" }), withId(id));
    await ticket.DELETE(request(`/api/tickets/${id}`, "DELETE"), withId(id));
    const rows = await db()`SELECT status FROM tickets WHERE id = ${id}`;
    expect(rows.map((row) => row.status)).toEqual(["open"]);
  });

  test("an attendant's presence check-in doesn't make them count as staff online", async () => {
    signInAs("attendant");
    await presence.POST();
    const response = await presence.GET();
    expect(await response.json()).toEqual({ online: false });
  });

  test("a person the login still knows but Clerk no longer has gets 401", async () => {
    signInAs("organiser");
    clerkServer.currentUser.mockResolvedValue(null);
    expect((await events.GET()).status).toBe(401);
    expect((await team.GET(request("/api/team"))).status).toBe(401);
    expect((await tickets.POST(request("/api/tickets", "POST", { description: "x" }))).status).toBe(401);
  });
});

describe("GET /api/events/cards", () => {
  test.each(PEOPLE)("gives a %s only the card fields", async (role) => {
    signInAs(role);
    const saved = await seedEvent({
      name: "Hackathon",
      description: "Private details",
      category: "Tech",
      date: "2026-11-14",
      start_time: "10:00 AM",
      end_time: "6:00 PM",
      venue: "Main hall",
      fee: "Free",
      registration_link: "forms.gle/abc",
      organiser: "E-Cell",
      coordinator_contact: "+91 90000 00000",
      eligibility: "Students",
      team_size: "4",
      prizes: "Trophy",
      notes: "Internal notes",
      custom_sections: [{ title: "Rules", content: "Secret rules" }],
    });
    const response = await eventCards.GET();
    expect(await response.json()).toEqual([
      {
        ref: saved.id.slice(0, 8),
        name: "Hackathon",
        category: "Tech",
        date: "2026-11-14",
        start_time: "10:00 AM",
        end_time: "6:00 PM",
        venue: "Main hall",
        fee: "Free",
        registration_link: "forms.gle/abc",
      },
    ]);
  });
});

describe("/api/team", () => {
  test("lists people, marks who's asking, and reads each role", async () => {
    signInAs("organiser", { id: "user_me", fullName: "Me" });
    addPerson("moderator", { id: "user_mod", fullName: null, username: "modname", email: "mod@example.com" });
    addPerson("attendant", { id: "user_att", fullName: null, username: null, email: null });

    const response = await team.GET(request("/api/team"));

    expect(await response.json()).toEqual([
      { id: "user_me", name: "Me", email: "user_me@example.com", role: "organiser", isSelf: true },
      { id: "user_mod", name: "modname", email: "mod@example.com", role: "moderator", isSelf: false },
      { id: "user_att", name: "", email: "", role: "attendant", isSelf: false },
    ]);
  });

  test("passes a trimmed search to Clerk, and no search when there isn't one", async () => {
    signInAs("organiser");
    await team.GET(request(`/api/team?q=${encodeURIComponent("  priya  ")}`));
    expect(clerkUsers.getUserList.mock.lastCall![0].query).toBe("priya");

    await team.GET(request("/api/team?q="));
    expect(clerkUsers.getUserList.mock.lastCall![0]).not.toHaveProperty("query");
  });

  test("an organiser can't change their own role", async () => {
    const me = signInAs("organiser");
    const response = await teamMember.PATCH(request(`/api/team/${me.id}`, "PATCH", { role: "attendant" }), withId(me.id));
    expect(response.status).toBe(400);
    expect(clerkUsers.updateUserMetadata).not.toHaveBeenCalled();
    expect(getPerson(me.id)?.publicMetadata.role).toBe("organiser");
  });

  test("an organiser can't change another organiser's role", async () => {
    signInAs("organiser");
    addPerson("organiser", { id: "user_other_organiser" });
    const response = await teamMember.PATCH(
      request("/api/team/user_other_organiser", "PATCH", { role: "attendant" }),
      withId("user_other_organiser"),
    );
    expect(response.status).toBe(403);
    expect(clerkUsers.updateUserMetadata).not.toHaveBeenCalled();
    expect(getPerson("user_other_organiser")?.publicMetadata.role).toBe("organiser");
  });

  test("makes an attendant a moderator, and back", async () => {
    signInAs("organiser");
    addPerson("attendant", { id: "user_target" });

    const promoted = await teamMember.PATCH(request("/api/team/user_target", "PATCH", { role: "moderator" }), withId("user_target"));
    expect(await promoted.json()).toEqual({ id: "user_target", role: "moderator" });
    expect(getPerson("user_target")?.publicMetadata.role).toBe("moderator");

    const demoted = await teamMember.PATCH(request("/api/team/user_target", "PATCH", { role: "attendant" }), withId("user_target"));
    expect(await demoted.json()).toEqual({ id: "user_target", role: "attendant" });
    expect(getPerson("user_target")?.publicMetadata.role).toBeNull();
  });

  test.each(["organiser", "admin", "", null, 5])("refuses the role %s, so nobody can be made an organiser here", async (role) => {
    signInAs("organiser");
    addPerson("attendant", { id: "user_target" });
    const response = await teamMember.PATCH(request("/api/team/user_target", "PATCH", { role }), withId("user_target"));
    expect(response.status).toBe(400);
    expect(clerkUsers.updateUserMetadata).not.toHaveBeenCalled();
  });

  test("gives 404 for someone who doesn't exist", async () => {
    signInAs("organiser");
    const response = await teamMember.PATCH(request("/api/team/user_nobody", "PATCH", { role: "moderator" }), withId("user_nobody"));
    expect(response.status).toBe(404);
  });
});

describe("getRole", () => {
  test("reads the login token without calling Clerk", async () => {
    signInAs("moderator", { roleInToken: true });
    expect(await getRole()).toBe("moderator");
    expect(clerkServer.currentUser).not.toHaveBeenCalled();
  });

  test("falls back to Clerk when the token has no role information", async () => {
    signInAs("organiser", { roleInToken: false });
    expect(await getRole()).toBe("organiser");
    expect(clerkServer.currentUser).toHaveBeenCalledTimes(1);
  });

  test("gives null when signed out, without calling Clerk", async () => {
    signOut();
    expect(await getRole()).toBeNull();
    expect(clerkServer.currentUser).not.toHaveBeenCalled();
  });

  test("gives null when Clerk no longer has this person", async () => {
    signInAs("attendant");
    clerkServer.currentUser.mockResolvedValue(null);
    expect(await getRole()).toBeNull();
  });

  describe.each([
    { source: "the token", roleInToken: true },
    { source: "Clerk", roleInToken: false },
  ])("from $source", ({ roleInToken }) => {
    test.each([
      { metadata: {}, label: "a missing role" },
      { metadata: { role: "admin" }, label: "an unknown role" },
      { metadata: { role: "ORGANISER" }, label: "a role in the wrong case" },
      { metadata: { role: ["organiser"] }, label: "a role that isn't a string" },
      { metadata: { role: null }, label: "an empty role" },
    ])("treats $label as attendant", async ({ metadata }) => {
      signInAs("attendant", { metadata, roleInToken });
      expect(await getRole()).toBe("attendant");
    });
  });

  test("denyUnlessStaff and denyUnlessOrganiser let through only the right people", async () => {
    signOut();
    expect((await denyUnlessStaff())?.status).toBe(401);
    expect((await denyUnlessOrganiser())?.status).toBe(401);
    signInAs("attendant");
    expect((await denyUnlessStaff())?.status).toBe(403);
    expect((await denyUnlessOrganiser())?.status).toBe(403);
    signInAs("moderator");
    expect(await denyUnlessStaff()).toBeNull();
    expect((await denyUnlessOrganiser())?.status).toBe(403);
    signInAs("organiser");
    expect(await denyUnlessStaff()).toBeNull();
    expect(await denyUnlessOrganiser()).toBeNull();
  });
});

// redirect() throws an error whose digest names where it's going.
async function redirectTarget(page: () => Promise<unknown>) {
  try {
    await page();
    return null;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw error;
  }
}

describe("page guards", () => {
  const PAGES: { name: string; page: () => Promise<unknown>; expected: Record<Who, string | null> }[] = [
    {
      name: "/organiser",
      page: OrganiserPage,
      expected: { signedOut: "/sign-in", attendant: "/chat", moderator: null, organiser: null },
    },
    {
      name: "/organiser/tickets",
      page: OrganiserTicketsPage,
      expected: { signedOut: "/sign-in", attendant: "/chat", moderator: null, organiser: null },
    },
    {
      name: "/organiser/team",
      page: OrganiserTeamPage,
      expected: { signedOut: "/sign-in", attendant: "/chat", moderator: "/organiser", organiser: null },
    },
    {
      name: "/organiser/errors",
      page: OrganiserErrorsPage,
      expected: { signedOut: "/sign-in", attendant: "/chat", moderator: "/organiser", organiser: null },
    },
    {
      name: "/chat",
      page: ChatPage,
      expected: { signedOut: "/sign-in", attendant: null, moderator: null, organiser: null },
    },
    {
      name: "/tickets",
      page: MyTicketsPage,
      expected: { signedOut: "/sign-in", attendant: null, moderator: null, organiser: null },
    },
    {
      name: "/",
      page: HomePage,
      expected: { signedOut: "/sign-in", attendant: "/chat", moderator: "/organiser", organiser: "/organiser" },
    },
  ];

  describe.each(PAGES)("$name", ({ page, expected }) => {
    test.each(["signedOut", ...PEOPLE] as Who[])("%s", async (who) => {
      signIn(who, false);
      expect(await redirectTarget(page)).toBe(expected[who]);
    });
  });

  test.each([
    ["/organiser", OrganiserPage, "moderator"],
    ["/organiser/tickets", OrganiserTicketsPage, "organiser"],
    ["/organiser/team", OrganiserTeamPage, "organiser"],
    ["/chat", ChatPage, "attendant"],
    ["/tickets", MyTicketsPage, "attendant"],
  ] as const)("%s passes the role on to the page", async (_name, page, role) => {
    signInAs(role);
    const element = (await page()) as { props: { role: Role } };
    expect(element.props.role).toBe(role);
  });
});

describe("the error log page", () => {
  test("shows recorded errors without naming the AI provider", async () => {
    signInAs("organiser");
    await logError("Anthropic-source", new Error("claude-sonnet said ANTHROPIC is overloaded"), { path: "/claude/path" });

    const html = renderToStaticMarkup((await OrganiserErrorsPage()) as React.ReactElement);

    expect(html).toContain("overloaded");
    expect(html).not.toMatch(/anthropic|claude/i);
  });

  test("the original wording stays in the database", async () => {
    await logError("chat", new Error("Anthropic is overloaded"));
    const rows = await db()`SELECT message FROM error_log`;
    expect(rows[0].message).toBe("Anthropic is overloaded");
  });

  test("says so when there's nothing to show", async () => {
    signInAs("organiser");
    const html = renderToStaticMarkup((await OrganiserErrorsPage()) as React.ReactElement);
    expect(html).toContain("no problems have been recorded");
  });

  test("still opens when the log can't be read", async () => {
    signInAs("organiser");
    await db()`ALTER TABLE error_log RENAME TO error_log_hidden`;
    try {
      const html = renderToStaticMarkup((await OrganiserErrorsPage()) as React.ReactElement);
      expect(html).toContain("Couldn&#x27;t load the error log");
    } finally {
      await db()`ALTER TABLE error_log_hidden RENAME TO error_log`;
    }
  });
});
