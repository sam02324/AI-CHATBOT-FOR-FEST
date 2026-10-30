import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { jsonError, readJson } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import {
  apiErrorMessage,
  chatSystem,
  classifyMessage,
  FALLBACK_BETA,
  getClient,
  HANDOFF_MESSAGE,
  MODEL,
  NO_KEY_MESSAGE,
  OFF_TOPIC_MESSAGE,
} from "@/lib/claude";
import { getMessages, saveExchange } from "@/lib/conversations";
import { listEvents } from "@/lib/db";

export const maxDuration = 60;

const MAX_CONTEXT_MESSAGES = 19;
const MAX_MESSAGE_LENGTH = 2000;

// Sends recent messages, always starting on a user's message.
function contextFrom(history: Anthropic.MessageParam[], question: string): Anthropic.MessageParam[] {
  const recent = history.slice(-MAX_CONTEXT_MESSAGES + 1);
  if (recent[0]?.role === "assistant") recent.shift();
  return [...recent, { role: "user", content: question }];
}

async function saveQuietly(conversationId: string, userId: string, question: string, answer: string) {
  try {
    await saveExchange(conversationId, userId, question, answer);
  } catch (error) {
    console.error("Couldn't save chat history", error);
  }
}

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);

  const body = ((await readJson(request)) ?? {}) as { conversationId?: unknown; message?: unknown };
  const question = typeof body.message === "string" ? body.message.trim() : "";
  if (!question || question.length > MAX_MESSAGE_LENGTH) return jsonError("Invalid message.", 400);

  const client = getClient();
  if (!client) return jsonError(NO_KEY_MESSAGE, 503);

  // History always comes from the database, so a request can't invent earlier messages.
  let conversationId: string = randomUUID();
  let history: Anthropic.MessageParam[] = [];
  if (typeof body.conversationId === "string") {
    const saved = await getMessages(body.conversationId, userId);
    if (!saved) return jsonError("Conversation not found.", 404);
    conversationId = body.conversationId;
    history = saved;
  }
  const messages = contextFrom(history, question);
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

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: chatSystem(events),
    messages,
  });

  // Wait for the first event, so a bad key or outage returns a real error status.
  const streamEvents = stream[Symbol.asyncIterator]();
  let first: Awaited<ReturnType<typeof streamEvents.next>>;
  try {
    first = await streamEvents.next();
  } catch (error) {
    console.error(error);
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
        if (final.stop_reason === "refusal" && !answer) {
          write("Sorry, I can't help with that. Please ask an event coordinator.");
        }
        if (answer) await saveQuietly(conversationId, userId, question, answer);
      } catch (error) {
        console.error(error);
        if (!cancelled) controller.enqueue(encoder.encode(`\n\n${apiErrorMessage(error)}`));
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
      stream.abort();
    },
  });

  return new Response(responseBody, { headers });
}
