import type { ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { POST as readPoster } from "@/app/api/extract/route";
import { classifyMessage, getClient, type MessageCategory } from "@/lib/claude";
import { loggedErrors, useTestDatabase } from "./helpers/db";
import { messageWith, sendCategory, sendJson, startAiServer } from "./helpers/ai-server";
import { request } from "./helpers/http";
import { knownBug } from "./helpers/known-bug";
import { signInAs } from "./helpers/people";

// These run the real SDK against a local server, because that's where the timeouts actually live.
// The first three take about 8 seconds each and the poster one takes over 20, on purpose.

useTestDatabase();

let server: Awaited<ReturnType<typeof startAiServer>>;

beforeAll(async () => {
  server = await startAiServer();
  // Must be set before the first getClient() call, which reads it once.
  process.env.ANTHROPIC_BASE_URL = server.url;
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
});

function classify() {
  return classifyMessage(getClient()!, [{ role: "user", content: "When is the hackathon?" }], []);
}

async function timed(work: () => Promise<MessageCategory>) {
  const startedAt = Date.now();
  const category = await work();
  return { category, seconds: (Date.now() - startedAt) / 1000 };
}

describe("classifyMessage gives up after about 8 seconds", () => {
  test("when the server never responds", { timeout: 20_000 }, async () => {
    server.respondWith(() => {});

    const { category, seconds } = await timed(classify);

    expect(category).toBe("question");
    expect(seconds).toBeGreaterThan(7.5);
    expect(seconds).toBeLessThan(12);
    expect(server.requests).toHaveLength(1);
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["classifier"]);
  });

  test("when the server sends headers and then stalls the body", { timeout: 20_000 }, async () => {
    server.respondWith((_body, response: ServerResponse) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"id":"msg_test",');
    });

    const { category, seconds } = await timed(classify);

    expect(category).toBe("question");
    expect(seconds).toBeGreaterThan(7.5);
    expect(seconds).toBeLessThan(12);
    expect(server.requests).toHaveLength(1);
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["classifier"]);
  });

  test("when the server stalls before sending any of the body", { timeout: 20_000 }, async () => {
    server.respondWith((_body, response: ServerResponse) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
    });

    const { category, seconds } = await timed(classify);

    expect(category).toBe("question");
    expect(seconds).toBeGreaterThan(7.5);
    expect(seconds).toBeLessThan(12);
  });
});

describe("classifyMessage with the real SDK", () => {
  test.each(["question", "needs_person", "off_topic"])("reads the category %s from the reply", async (expected) => {
    server.respondWith((_body, response) => sendCategory(response, expected));
    expect(await classify()).toBe(expected);
  });

  test("asks for the right model with the fake key, and doesn't stream", async () => {
    server.respondWith((_body, response) => sendCategory(response, "question"));
    await classify();
    const [body] = server.requests;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.stream).toBeUndefined();
    expect(body.output_config.format.type).toBe("json_schema");
  });

  test("reads past the thinking block this model sends first", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "abc" };
    server.respondWith((_body, response) => {
      const reply = messageWith(JSON.stringify({ category: "needs_person" }));
      sendJson(response, 200, { ...reply, content: [thinking, ...reply.content] });
    });
    expect(await classify()).toBe("needs_person");
  });

  test("running out of tokens while thinking counts as a question", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "abc" };
    server.respondWith((_body, response) => {
      sendJson(response, 200, { ...messageWith("", "max_tokens"), content: [thinking] });
    });
    expect(await classify()).toBe("question");
  });

  test("a refusal counts as off-topic", async () => {
    server.respondWith((_body, response) => sendJson(response, 200, messageWith("", "refusal")));
    expect(await classify()).toBe("off_topic");
  });

  // The SDK's parse throws on the unfinished text before the code ever looks at stop_reason.
  knownBug("BUG: a refusal that comes after some text also counts as off-topic", async () => {
    server.respondWith((_body, response) => sendJson(response, 200, messageWith('{"categ', "refusal")));
    expect(await classify()).toBe("off_topic");
  });

  test("a reply it can't read counts as a question, and is logged", async () => {
    server.respondWith((_body, response) => sendJson(response, 200, messageWith("not json at all")));
    expect(await classify()).toBe("question");
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["classifier"]);
  });

  test("a category it doesn't know counts as a question", async () => {
    server.respondWith((_body, response) => sendCategory(response, "something_else"));
    expect(await classify()).toBe("question");
  });

  test("a server error counts as a question, without retrying", async () => {
    server.respondWith((_body, response) => sendJson(response, 500, { type: "error", error: { type: "api_error", message: "Oops" } }));
    expect(await classify()).toBe("question");
    expect(server.requests).toHaveLength(1);
  });
});

describe("reading a poster", () => {
  const POSTER = {
    is_event_poster: true,
    same_event: true,
    name: "Robotics",
    description: null,
    date: null,
    start_time: null,
    end_time: null,
    venue: null,
    category: null,
    organiser: null,
    coordinator_contact: null,
    registration_link: null,
    fee: null,
    eligibility: null,
    team_size: null,
    prizes: null,
    notes: null,
    custom_sections: [],
    uncertain_fields: [],
  };
  const IMAGES = { images: [{ data: "aGVsbG8=", mediaType: "image/png" }] };

  test("gives back what the real SDK parsed", async () => {
    signInAs("moderator");
    server.respondWith((_body, response) => sendJson(response, 200, messageWith(JSON.stringify(POSTER))));
    const response = await readPoster(request("/api/extract", "POST", IMAGES));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(POSTER);
  });

  // The route means to answer these with 422 and "enter the details manually", but the SDK's parse
  // throws on text that isn't valid JSON, so they become a 502 and "Please try again".
  knownBug("BUG: a reply that can't be read gives the 422 that asks for manual entry", async () => {
    signInAs("moderator");
    server.respondWith((_body, response) => sendJson(response, 200, messageWith("Sorry, not JSON")));
    const response = await readPoster(request("/api/extract", "POST", IMAGES));
    expect(response.status).toBe(422);
  });

  knownBug("BUG: a reply cut off by the token limit gives the 422 that asks for manual entry", async () => {
    signInAs("moderator");
    server.respondWith((_body, response) => sendJson(response, 200, messageWith('{"is_event_poster":true,', "max_tokens")));
    const response = await readPoster(request("/api/extract", "POST", IMAGES));
    expect(response.status).toBe(422);
  });

  knownBug("BUG: a refusal that comes after some text gives the 422 that asks for manual entry", async () => {
    signInAs("moderator");
    server.respondWith((_body, response) => sendJson(response, 200, messageWith('{"is_event_poster":true,', "refusal")));
    const response = await readPoster(request("/api/extract", "POST", IMAGES));
    expect(response.status).toBe(422);
  });

  test("a refusal with no text gives 422", async () => {
    signInAs("moderator");
    server.respondWith((_body, response) => sendJson(response, 200, messageWith("", "refusal")));
    const response = await readPoster(request("/api/extract", "POST", IMAGES));
    expect(response.status).toBe(422);
  });

  test(
    "a poster that takes 22 seconds to read still works",
    async () => {
      signInAs("moderator");
      server.respondWith((_body, response) => {
        const reply = setTimeout(() => sendJson(response, 200, messageWith(JSON.stringify(POSTER))), 22_000);
        response.on("close", () => clearTimeout(reply));
      });

      const response = await readPoster(request("/api/extract", "POST", IMAGES));

      expect(response.status).toBe(200);
    },
    30_000,
  );
});
