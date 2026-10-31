import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DELETE, PUT } from "@/app/api/events/[id]/route";
import { GET as getCards } from "@/app/api/events/cards/route";
import { GET, POST } from "@/app/api/events/route";
import { POST as readPoster } from "@/app/api/extract/route";
import { GET as getPresence, POST as postPresence } from "@/app/api/presence/route";
import { db, listEvents } from "@/lib/db";
import { EMPTY_EVENT, EVENT_FIELDS, type FestEvent } from "@/lib/event-fields";
import { aiWasCalled, fakeClient, resetAi } from "./helpers/ai";
import { countRows, loggedErrors, seedEvent, useTestDatabase } from "./helpers/db";
import { request, withId } from "./helpers/http";
import { signInAs } from "./helpers/people";

vi.mock("@/lib/claude", async (importOriginal) => {
  const { fakeClient } = await import("./helpers/ai");
  return {
    ...(await importOriginal<typeof import("@/lib/claude")>()),
    getClient: () => (process.env.ANTHROPIC_API_KEY ? fakeClient : null),
  };
});

useTestDatabase();

beforeEach(() => {
  resetAi();
  signInAs("moderator");
});

// Halfway through an hour, so a fixed window can't roll over during a test.
const MID_HOUR = Date.UTC(2026, 10, 14, 12, 30, 30);

function createEvent(body: unknown) {
  return POST(request("/api/events", "POST", body));
}

function updateEvent(id: string, body: unknown) {
  return PUT(request(`/api/events/${id}`, "PUT", body), withId(id));
}

async function listEventNames() {
  return (await listEvents()).map((event) => event.name);
}

describe("creating events", () => {
  test("saves the event and gives it an ID", async () => {
    const response = await createEvent({
      name: "  Hackathon ",
      venue: "Main hall",
      custom_sections: [{ title: "Rules", content: "Be kind" }],
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as FestEvent;
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toMatchObject({ name: "Hackathon", venue: "Main hall" });

    const listed = (await (await GET()).json()) as FestEvent[];
    expect(listed).toEqual([{ ...EMPTY_EVENT, id: created.id, name: "Hackathon", venue: "Main hall", custom_sections: [{ title: "Rules", content: "Be kind" }] }]);
  });

  test("puts each field in its own column, when creating and when updating", async () => {
    const details = (prefix: string) => Object.fromEntries(EVENT_FIELDS.map((field) => [field, `${prefix} ${field}`]));

    const created = (await (await createEvent(details("first"))).json()) as FestEvent;
    expect((await listEvents())[0]).toEqual({ ...details("first"), id: created.id, custom_sections: [] });

    await updateEvent(created.id, details("second"));
    expect((await listEvents())[0]).toEqual({ ...details("second"), id: created.id, custom_sections: [] });
  });

  test.each([[{}], [{ name: "" }], [{ name: "   " }], [{ name: 5 }], [null]])("requires a name: %j", async (body) => {
    expect((await createEvent(body)).status).toBe(400);
    expect(await countRows("events")).toBe(0);
  });

  test("rejects a body that isn't JSON", async () => {
    const response = await POST(new Request("http://localhost/api/events", { method: "POST", body: "{nope" }));
    expect(response.status).toBe(400);
  });

  test("can't choose its own ID or store unknown fields", async () => {
    const created = (await (await createEvent({ id: "my-id", name: "Hackathon", secret: "x" })).json()) as FestEvent;
    expect(created.id).not.toBe("my-id");
    expect(created).not.toHaveProperty("secret");
  });

  test("keeps tricky text as plain text", async () => {
    const tricky = "'); DROP TABLE events;--";
    await createEvent({ name: tricky, venue: tricky, custom_sections: [{ title: tricky, content: tricky }] });
    const [event] = await listEvents();
    expect(event).toMatchObject({ name: tricky, venue: tricky, custom_sections: [{ title: tricky, content: tricky }] });
  });

  test("a NUL character gives a clean response", async () => {
    const response = await createEvent({ name: "before\u0000after" });
    expect([201, 400]).toContain(response.status);
  });
});

describe("listing events", () => {
  test("goes by date, then time, then name", async () => {
    await seedEvent({ name: "Later day", date: "2026-11-15", start_time: "10:00 AM" });
    await seedEvent({ name: "B same time", date: "2026-11-14", start_time: "10:00 AM" });
    await seedEvent({ name: "A same time", date: "2026-11-14", start_time: "10:00 AM" });
    expect(await listEventNames()).toEqual(["A same time", "B same time", "Later day"]);
  });

  test("is stable even when everything matches, because the prompt is cached", async () => {
    await seedEvent({ name: "Same" });
    await seedEvent({ name: "Same" });
    const first = await listEvents();
    const second = await listEvents();
    expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
    expect(first.map((event) => event.id)).toEqual(first.map((event) => event.id).sort());
  });

  test("events on the same day are in time order", async () => {
    await seedEvent({ name: "Afternoon", date: "2026-11-14", start_time: "2:00 PM" });
    await seedEvent({ name: "Morning", date: "2026-11-14", start_time: "9:00 AM" });
    await seedEvent({ name: "Late morning", date: "2026-11-14", start_time: "10:00 AM" });
    expect(await listEventNames()).toEqual(["Morning", "Late morning", "Afternoon"]);
  });
});

describe("changing events", () => {
  test("updates every field, and leaves other events alone", async () => {
    const event = await seedEvent({ name: "Old name", venue: "Old venue", custom_sections: [{ title: "Rules", content: "Old" }] });
    const other = await seedEvent({ name: "Other" });

    const response = await updateEvent(event.id, { name: "New name", fee: "Free" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...EMPTY_EVENT, id: event.id, name: "New name", fee: "Free" });
    const saved = await listEvents();
    expect(saved.find((item) => item.id === event.id)).toEqual({ ...EMPTY_EVENT, id: event.id, name: "New name", fee: "Free" });
    expect(saved.find((item) => item.id === other.id)?.name).toBe("Other");
  });

  test("the ID in the body is ignored", async () => {
    const event = await seedEvent();
    const updated = (await (await updateEvent(event.id, { id: "other-id", name: "New" })).json()) as FestEvent;
    expect(updated.id).toBe(event.id);
    const rows = await db()`SELECT id FROM events`;
    expect(rows.map((row) => row.id)).toEqual([event.id]);
  });

  test("requires a name", async () => {
    const event = await seedEvent({ name: "Keep me" });
    expect((await updateEvent(event.id, { name: " " })).status).toBe(400);
    expect(await listEventNames()).toEqual(["Keep me"]);
  });

  test("an event that doesn't exist is 404", async () => {
    expect((await updateEvent("none", { name: "New" })).status).toBe(404);
    expect((await DELETE(request("/api/events/none", "DELETE"), withId("none"))).status).toBe(404);
  });

  test("deleting removes only that event", async () => {
    const event = await seedEvent({ name: "Going" });
    await seedEvent({ name: "Staying" });
    const response = await DELETE(request(`/api/events/${event.id}`, "DELETE"), withId(event.id));
    expect(response.status).toBe(204);
    expect(await listEventNames()).toEqual(["Staying"]);
  });

  test("an ID written like an attack doesn't change anything", async () => {
    await seedEvent({ name: "Safe" });
    const attack = "x' OR '1'='1";
    expect((await updateEvent(attack, { name: "Hacked" })).status).toBe(404);
    expect((await DELETE(request("/api/events/x", "DELETE"), withId(attack))).status).toBe(404);
    expect(await listEventNames()).toEqual(["Safe"]);
  });

  test("a saved event shows up as a card with its short reference", async () => {
    const saved = (await (await createEvent({ name: "Hackathon" })).json()) as FestEvent;
    const [card] = (await (await getCards()).json()) as { ref: string; name: string }[];
    expect(card).toMatchObject({ ref: saved.id.slice(0, 8), name: "Hackathon" });
  });
});

describe("reading posters", () => {
  const IMAGE = { data: "aGVsbG8=", mediaType: "image/png" };
  const POSTER = {
    is_event_poster: true,
    same_event: true,
    name: "Robotics",
    custom_sections: [],
    uncertain_fields: [],
  };

  function read(body: unknown) {
    return readPoster(request("/api/extract", "POST", body));
  }

  function parseGives(result: unknown) {
    fakeClient.messages.parse.mockResolvedValue(result);
  }

  test("sends every image and gives back the details, without saving anything", async () => {
    parseGives({ stop_reason: "end_turn", parsed_output: POSTER });

    const response = await read({ images: [IMAGE, { data: "d29ybGQ=", mediaType: "image/webp" }] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(POSTER);
    const params = fakeClient.messages.parse.mock.lastCall![0];
    const content = params.messages[0].content;
    expect(content.map((block: { type: string }) => block.type)).toEqual(["image", "image", "text"]);
    expect(content[1].source).toEqual({ type: "base64", media_type: "image/webp", data: "d29ybGQ=" });
    expect(content[2].text).toContain("These 2 images");
    expect(await countRows("events")).toBe(0);
  });

  test("gives up by itself, and doesn't retry", async () => {
    parseGives({ stop_reason: "end_turn", parsed_output: POSTER });
    await read({ images: [IMAGE] });
    const options = fakeClient.messages.parse.mock.lastCall![1] as { maxRetries: number; signal: AbortSignal };
    expect(options.maxRetries).toBe(0);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    ["no images", {}],
    ["an empty list", { images: [] }],
    ["images that aren't a list", { images: "nope" }],
    ["six images", { images: Array(6).fill(IMAGE) }],
    ["an unknown type", { images: [{ data: "x", mediaType: "image/svg+xml" }] }],
    ["no type", { images: [{ data: "x" }] }],
    ["no data", { images: [{ mediaType: "image/png" }] }],
    ["empty data", { images: [{ data: "", mediaType: "image/png" }] }],
    ["data that isn't text", { images: [{ data: 5, mediaType: "image/png" }] }],
    ["an image that isn't an object", { images: [null] }],
    ["a bad body", null],
  ])("rejects %s without any AI call", async (_name, body) => {
    expect((await read(body)).status).toBe(400);
    expect(aiWasCalled()).toBe(false);
  });

  test.each(["image/jpeg", "image/png", "image/webp", "image/gif"])("accepts %s", async (mediaType) => {
    parseGives({ stop_reason: "end_turn", parsed_output: POSTER });
    expect((await read({ images: [{ data: "aGVsbG8=", mediaType }] })).status).toBe(200);
  });

  test("accepts five images", async () => {
    parseGives({ stop_reason: "end_turn", parsed_output: POSTER });
    expect((await read({ images: Array(5).fill(IMAGE) })).status).toBe(200);
  });

  test("rejects images that are too large in total", async () => {
    const big = { data: "x".repeat(2.5 * 1024 * 1024), mediaType: "image/png" };
    expect((await read({ images: [big, big] })).status).toBe(413);
    expect(aiWasCalled()).toBe(false);
  });

  test.each([
    ["a refusal", { stop_reason: "refusal", parsed_output: null }, "Couldn't read that"],
    ["a reply it can't read", { stop_reason: "end_turn", parsed_output: null }, "Couldn't read that"],
    ["not a poster", { stop_reason: "end_turn", parsed_output: { ...POSTER, is_event_poster: false } }, "doesn't look like an event poster"],
    ["different events", { stop_reason: "end_turn", parsed_output: { ...POSTER, same_event: false } }, "different events"],
  ])("%s gives 422", async (_name, result, message) => {
    parseGives(result);
    const response = await read({ images: [IMAGE] });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain(message);
  });

  test("an AI failure gives 502 and is logged, without naming the provider", async () => {
    fakeClient.messages.parse.mockRejectedValue(new Anthropic.AuthenticationError(401, undefined, "Anthropic says no", new Headers()));
    const response = await read({ images: [IMAGE] });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("The API key was rejected. Check the key in .env.local.");
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["poster"]);
  });

  test("with no API key it says so", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await read({ images: [IMAGE] })).status).toBe(503);
    expect(await db()`SELECT 1 FROM rate_limits`).toHaveLength(0);
  });

  test("the 31st poster in an hour gets 429 before any AI call", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MID_HOUR);
    parseGives({ stop_reason: "end_turn", parsed_output: POSTER });
    for (let index = 0; index < 30; index++) expect((await read({ images: [IMAGE] })).status).toBe(200);
    fakeClient.messages.parse.mockClear();

    const response = await read({ images: [IMAGE] });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1770");
    expect(aiWasCalled()).toBe(false);
  });

  test("posters count towards the shared AI budget", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "1");
    vi.spyOn(Date, "now").mockReturnValue(MID_HOUR);
    parseGives({ stop_reason: "end_turn", parsed_output: POSTER });
    expect((await read({ images: [IMAGE] })).status).toBe(200);
    fakeClient.messages.parse.mockClear();
    expect((await read({ images: [IMAGE] })).status).toBe(429);
    expect(aiWasCalled()).toBe(false);
  });

  test("a rejected request doesn't use up the limit", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MID_HOUR);
    for (let index = 0; index < 35; index++) await read({ images: [] });
    expect(await db()`SELECT 1 FROM rate_limits`).toHaveLength(0);
  });
});

describe("staff presence", () => {
  test("checking in makes staff count as online for 45 seconds", async () => {
    expect(await (await getPresence()).json()).toEqual({ online: false });

    expect((await postPresence()).status).toBe(204);
    expect(await (await getPresence()).json()).toEqual({ online: true });

    await db()`UPDATE staff_presence SET last_seen = now() - interval '44 seconds'`;
    expect(await (await getPresence()).json()).toEqual({ online: true });

    await db()`UPDATE staff_presence SET last_seen = now() - interval '46 seconds'`;
    expect(await (await getPresence()).json()).toEqual({ online: false });
  });

  test("checking in again keeps one row per person", async () => {
    await postPresence();
    await postPresence();
    const rows = await db()`SELECT user_id FROM staff_presence`;
    expect(rows).toEqual([{ user_id: "user_moderator" }]);
  });
});
