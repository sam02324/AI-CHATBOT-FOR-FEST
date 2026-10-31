import type { ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { countRows, loggedErrors, savedMessages, useTestDatabase } from "./helpers/db";
import {
  messageWith,
  sendCategory,
  sendEndOfAnswer,
  sendEvent,
  sendJson,
  sendStartOfAnswer,
  sendText,
  startAiServer,
  startEventStream,
} from "./helpers/ai-server";
import { request } from "./helpers/http";
import { signInAs } from "./helpers/people";

// tests/chat.test.ts fakes the stream. These check the same route against the real SDK and real
// server-sent events, so the fake can't drift away from what actually happens.

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
  signInAs("attendant");
});

function ask(message: string) {
  return POST(request("/api/chat", "POST", { message }));
}

// Screening always says it's a question, and the answer does whatever the test wants.
function answerWith(answer: (response: ServerResponse) => void) {
  server.respondWith((body, response) => {
    if (body.stream) answer(response);
    else sendCategory(response, "question");
  });
}

function answerRequests() {
  return server.requests.filter((body) => body.stream);
}

async function settle() {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("the chat route with the real SDK", () => {
  test("streams an answer and saves it", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "The hackathon ");
      sendText(response, "is on Saturday.\n[[events: a1b2c3d4]]");
      sendEndOfAnswer(response);
    });

    const response = await ask("When is the hackathon?");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("The hackathon is on Saturday.\n[[events: a1b2c3d4]]");
    const id = response.headers.get("X-Conversation-Id")!;
    expect(await savedMessages(id)).toEqual([
      { role: "user", content: "When is the hackathon?" },
      { role: "assistant", content: "The hackathon is on Saturday.\n[[events: a1b2c3d4]]" },
    ]);
  });

  test("asks for the right model, with the cache marker on the first system block", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "Hi");
      sendEndOfAnswer(response);
    });

    await (await ask("Hello")).text();

    expect(server.requests.map((body) => body.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
    const [body] = answerRequests();
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[1].cache_control).toBeUndefined();
  });

  test("only shows text, not the thinking blocks this model sends first", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendEvent(response, { type: "message_start", message: { ...messageWith(""), stop_reason: null } });
      sendEvent(response, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
      sendEvent(response, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Private reasoning" } });
      sendEvent(response, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "abc" } });
      sendEvent(response, { type: "content_block_stop", index: 0 });
      sendEvent(response, { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
      sendEvent(response, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "The visible answer" } });
      sendEvent(response, { type: "content_block_stop", index: 1 });
      sendEvent(response, { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
      sendEvent(response, { type: "message_stop" });
      response.end();
    });

    const response = await ask("Hello");

    expect(await response.text()).toBe("The visible answer");
    expect(await savedMessages(response.headers.get("X-Conversation-Id")!)).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "The visible answer" },
    ]);
  });

  test("a refusal with no text gets the polite reply", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendEndOfAnswer(response, "refusal");
    });

    const response = await ask("Something bad");

    expect(await response.text()).toContain("Sorry, I can't help with that");
  });

  test("a rejected key gives 502 right away, without a retry", async () => {
    answerWith((response) => sendJson(response, 401, { type: "error", error: { type: "authentication_error", message: "bad key" } }));

    const response = await ask("Hello");

    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("The API key was rejected");
    expect(answerRequests()).toHaveLength(1);
    expect(await countRows("conversations")).toBe(0);
  });

  test("a server error is retried once, and then gives 502", async () => {
    answerWith((response) => sendJson(response, 500, { type: "error", error: { type: "api_error", message: "Oops" } }));

    const response = await ask("Hello");

    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("returned an error (500)");
    expect(answerRequests()).toHaveLength(2);
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["chat"]);
  });

  test("an error event partway through makes the reader reject, and saves nothing", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "The start of");
      sendEvent(response, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
      response.end();
    });

    const response = await ask("Hello");

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
    expect(await countRows("conversations")).toBe(0);
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["chat"]);
  });

  test("a connection cut partway through makes the reader reject, and saves nothing", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "The start of");
      setTimeout(() => response.destroy(), 20);
    });

    const response = await ask("Hello");

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
    expect(await countRows("conversations")).toBe(0);
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["chat"]);
  });

  test("a garbled event partway through makes the reader reject, and saves nothing", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "The start of");
      response.write("event: content_block_delta\ndata: {not json\n\n");
    });

    const response = await ask("Hello");

    await expect(response.text()).rejects.toThrow();
    expect(await countRows("conversations")).toBe(0);
  });

  test("a stream with no events at all gives 502", async () => {
    answerWith((response) => {
      startEventStream(response);
      response.end();
    });

    const response = await ask("Hello");

    expect(response.status).toBe(502);
    expect(await countRows("conversations")).toBe(0);
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["chat"]);
  });

  test("a stream that ends tidily before the message finishes rejects too, and saves nothing", async () => {
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "The start of");
      response.end();
    });

    const response = await ask("Hello");

    await expect(response.text()).rejects.toThrow();
    expect(await countRows("conversations")).toBe(0);
  });

  test("a client cancel aborts the request without logging an error or saving", async () => {
    let answerConnection: ServerResponse | undefined;
    answerWith((response) => {
      answerConnection = response;
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "The start of");
    });

    const response = await ask("Hello");
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("The start of");

    await reader.cancel();
    await vi.waitFor(() => expect(answerConnection?.destroyed || answerConnection?.closed).toBe(true));
    await settle();

    expect(console.error).not.toHaveBeenCalled();
    expect(await loggedErrors()).toEqual([]);
    expect(await countRows("chat_messages")).toBe(0);
  });

  test("the deadline gives 502 if the answer never starts", { timeout: 25_000 }, async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    answerWith(() => {});

    const pending = ask("Hello");
    await vi.waitFor(() => expect(answerRequests()).toHaveLength(1));
    const deadline = timers.mock.calls.find(([, delay]) => delay !== undefined && delay > 40_000 && delay <= 50_000);
    (deadline![0] as () => void)();
    const response = await pending;

    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("took too long");
  });

  test("the deadline makes the reader reject if the answer stalls midway", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    answerWith((response) => {
      startEventStream(response);
      sendStartOfAnswer(response);
      sendText(response, "The start of");
    });

    const response = await ask("Hello");
    const reader = response.body!.getReader();
    await reader.read();
    const deadline = timers.mock.calls.find(([, delay]) => delay !== undefined && delay > 40_000 && delay <= 50_000);
    (deadline![0] as () => void)();

    await expect(reader.read()).rejects.toThrow();
    expect(await countRows("chat_messages")).toBe(0);
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["chat"]);
  });
});
