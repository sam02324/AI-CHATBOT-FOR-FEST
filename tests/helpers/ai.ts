import Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import type { MessageCategory } from "@/lib/claude";

// Stands in for the client from getClient. Everything else in lib/claude.ts stays real,
// including classifyMessage, which only ever sees this client's messages.parse.

export type StreamScript = {
  // The answer's text, one piece per event.
  chunks?: string[];
  stopReason?: string;
  // Thrown after the chunks, or straight away if there are none.
  error?: Error;
  // Fails only in finalMessage, like a stream that ends without finishing its message.
  finalError?: Error;
  // Stays open after the chunks until it's aborted.
  hang?: boolean;
};

type StreamEvent = { type: string; delta?: { type: string; text?: string } };

// Follows the SDK's MessageStream: aborting rejects a waiting read, later reads report the end,
// and finalMessage rejects with whatever ended the stream.
function fakeStream({ chunks = [], stopReason = "end_turn", error, finalError, hang = false }: StreamScript) {
  const events: StreamEvent[] = chunks.flatMap((text) => [
    { type: "content_block_delta", delta: { type: "thinking_delta" } },
    { type: "content_block_delta", delta: { type: "text_delta", text } },
  ]);
  if (events.length > 0) events.unshift({ type: "message_start" });
  let position = 0;
  let aborted = false;
  let rejectWaiting: ((reason: Error) => void) | null = null;

  return {
    abort: vi.fn(() => {
      aborted = true;
      rejectWaiting?.(new Anthropic.APIUserAbortError());
    }),
    finalMessage: vi.fn(async () => {
      if (aborted) throw new Anthropic.APIUserAbortError();
      if (error ?? finalError) throw error ?? finalError;
      return { stop_reason: stopReason };
    }),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (aborted) return { done: true, value: undefined };
          if (position < events.length) return { done: false, value: events[position++] };
          if (error) throw error;
          if (hang) return new Promise<never>((_, reject) => (rejectWaiting = reject));
          return { done: true, value: undefined };
        },
      };
    },
  };
}

const DEFAULT_ANSWER: StreamScript = { chunks: ["Hello", " there"] };

// What the fake does next. Tests change these before calling a route.
export const ai = {
  category: "question" as MessageCategory,
  script: DEFAULT_ANSWER,
  streams: [] as ReturnType<typeof fakeStream>[],
};

export const fakeClient = {
  messages: {
    parse: vi.fn(async (_params: Record<string, any>, _options?: unknown): Promise<unknown> => ({
      stop_reason: "end_turn",
      parsed_output: { category: ai.category },
    })),
    stream: vi.fn((_params: Record<string, any>) => {
      const stream = fakeStream(ai.script);
      ai.streams.push(stream);
      return stream;
    }),
  },
};

export function resetAi() {
  ai.category = "question";
  ai.script = DEFAULT_ANSWER;
  ai.streams = [];
  fakeClient.messages.parse.mockReset();
  fakeClient.messages.stream.mockReset();
}

export function aiWasCalled() {
  return fakeClient.messages.parse.mock.calls.length + fakeClient.messages.stream.mock.calls.length > 0;
}
