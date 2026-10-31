import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A local stand-in for the AI service, for tests that run the real SDK against it.

type Handler = (body: Record<string, any>, response: ServerResponse) => void;

export async function startAiServer() {
  let handler: Handler = () => {};
  const requests: Record<string, any>[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body);
      handler(body, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respondWith(next: Handler) {
      handler = next;
    },
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function messageWith(text: string, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: text ? [{ type: "text", text }] : [],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

// The classifier's non-streaming reply.
export function sendCategory(response: ServerResponse, category: string) {
  sendJson(response, 200, messageWith(JSON.stringify({ category })));
}

export function startEventStream(response: ServerResponse) {
  response.writeHead(200, { "content-type": "text/event-stream" });
}

export function sendEvent(response: ServerResponse, event: Record<string, any> & { type: string }) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function sendStartOfAnswer(response: ServerResponse) {
  sendEvent(response, { type: "message_start", message: { ...messageWith(""), stop_reason: null } });
  sendEvent(response, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
}

export function sendText(response: ServerResponse, text: string) {
  sendEvent(response, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
}

export function sendEndOfAnswer(response: ServerResponse, stopReason = "end_turn") {
  sendEvent(response, { type: "content_block_stop", index: 0 });
  sendEvent(response, {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  sendEvent(response, { type: "message_stop" });
  response.end();
}
