import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { jsonError, readJson } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import {
  apiErrorMessage,
  chatSystem,
  classifyMessage,
  getClient,
  HANDOFF_MESSAGE,
  MODEL,
  NO_KEY_MESSAGE,
  OFF_TOPIC_MESSAGE,
} from "@/lib/claude";
import { getRecentMessages, saveExchange } from "@/lib/conversations";
import { listEvents } from "@/lib/db";
import { logError } from "@/lib/errors";
import { enforceAiLimits, LIMITS } from "@/lib/rate-limit";

export const maxDuration = 60;

const MAX_CONTEXT_MESSAGES = 19;
const MAX_MESSAGE_LENGTH = 2000;
// Vercel stops this function at maxDuration, so the answer is given up on while there's still time to say so.
const ANSWER_DEADLINE_MS = 50_000;

async function saveQuietly(conversationId: string, userId: string, question: string, answer: string) {
  try {
    await saveExchange(conversationId, userId, question, answer);
  } catch (error) {
    await logError("chat-history", error);
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);

  const body = ((await readJson(request)) ?? {}) as { conversationId?: unknown; message?: unknown };
  const question = typeof body.message === "string" ? body.message.trim() : "";
  if (!question || question.length > MAX_MESSAGE_LENGTH) return jsonError("Invalid message.", 400);

  const client = getClient();
  if (!client) return jsonError(NO_KEY_MESSAGE, 503);

  const limited = await enforceAiLimits(userId, LIMITS.chat);
  if (limited) return limited;

  // History always comes from the database, so a request can't invent earlier messages.
  // An ID with no messages starts a new chat. It may never have saved, been deleted, or be someone else's.
  let conversationId: string = randomUUID();
  let history: Anthropic.MessageParam[] = [];
  if (typeof body.conversationId === "string") {
    const saved = await getRecentMessages(body.conversationId, userId, MAX_CONTEXT_MESSAGES - 1);
    if (saved.length > 0) {
      conversationId = body.conversationId;
      history = saved;
    }
  }
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: question }];
  const headers = { "Content-Type": "text/plain; charset=utf-8", "X-Conversation-Id": conversationId };

  const events = await listEvents();
  const category = await classifyMessage(client, messages, events);
  if (category === "off_topic") {
    await saveQuietly(conversationId, userId, question, OFF_TOPIC_MESSAGE);
    return new Response(OFF_TOPIC_MESSAGE, { headers });
  }
  if (category === "needs_person") {
    await saveQuietly(conversationId, userId, question, HANDOFF_MESSAGE);
    return new Response(HANDOFF_MESSAGE, { headers: { ...headers, "X-Chat-Action": "handoff" } });
  }

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: chatSystem(events),
    messages,
  });
  const deadline = setTimeout(() => stream.abort(), startedAt + ANSWER_DEADLINE_MS - Date.now());

  // Wait for the first event, so a bad key or outage returns a real error status.
  const streamEvents = stream[Symbol.asyncIterator]();
  let first: Awaited<ReturnType<typeof streamEvents.next>>;
  try {
    first = await streamEvents.next();
  } catch (error) {
    clearTimeout(deadline);
    await logError("chat", error);
    return jsonError(apiErrorMessage(error), 502);
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      const write = (text: string) => {
        answer += text;
        if (!cancelled) controller.enqueue(encoder.encode(text));
      };
      try {
        for (let result = first; !result.done; result = await streamEvents.next()) {
          const event = result.value;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") write(event.delta.text);
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          // Text sent before a refusal is unfinished, so it's dropped rather than saved as an answer.
          if (answer) throw new Error("The answer was refused partway through.");
          write("Sorry, I can't help with that. Please ask an event coordinator.");
        }
        if (answer) await saveQuietly(conversationId, userId, question, answer);
        if (!cancelled) controller.close();
      } catch (error) {
        // Failing the stream makes the page drop the partial answer and offer Try again.
        // The error is recorded first, because the function can stop as soon as the response ends.
        if (!cancelled) {
          await logError("chat", error);
          controller.error(error);
        }
      } finally {
        clearTimeout(deadline);
      }
    },
    cancel() {
      cancelled = true;
      stream.abort();
    },
  });

  return new Response(responseBody, { headers });
}
