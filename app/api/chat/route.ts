import type Anthropic from "@anthropic-ai/sdk";
import { jsonError, readJson } from "@/lib/api";
import { denyUnlessSignedIn } from "@/lib/auth";
import {
  apiErrorMessage,
  chatSystem,
  FALLBACK_BETA,
  getClient,
  isOnTopic,
  MODEL,
  NO_KEY_MESSAGE,
  OFF_TOPIC_MESSAGE,
} from "@/lib/claude";
import { listEvents } from "@/lib/db";

export const maxDuration = 60;

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;

function validMessages(messages: unknown): messages is Anthropic.MessageParam[] {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_MESSAGES &&
    messages.at(-1)?.role === "user" &&
    messages.every(
      (message) =>
        ["user", "assistant"].includes(message?.role) &&
        typeof message.content === "string" &&
        message.content.length > 0 &&
        message.content.length <= MAX_MESSAGE_LENGTH,
    )
  );
}

export async function POST(request: Request) {
  const denied = await denyUnlessSignedIn();
  if (denied) return denied;

  const { messages } = ((await readJson(request)) ?? {}) as { messages?: unknown };
  if (!validMessages(messages)) return jsonError("Invalid message.", 400);

  const client = getClient();
  if (!client) return jsonError(NO_KEY_MESSAGE, 503);

  const events = await listEvents();
  if (!(await isOnTopic(client, messages, events))) {
    return new Response(OFF_TOPIC_MESSAGE, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
  const events = stream[Symbol.asyncIterator]();
  let first: Awaited<ReturnType<typeof events.next>>;
  try {
    first = await events.next();
  } catch (error) {
    console.error(error);
    return jsonError(apiErrorMessage(error), 502);
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let wroteText = false;
      try {
        for (let result = first; !result.done; result = await events.next()) {
          const event = result.value;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
            wroteText = true;
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal" && !wroteText) {
          controller.enqueue(encoder.encode("Sorry, I can't help with that. Please ask an event coordinator."));
        }
      } catch (error) {
        console.error(error);
        controller.enqueue(encoder.encode(`\n\n${apiErrorMessage(error)}`));
      }
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
