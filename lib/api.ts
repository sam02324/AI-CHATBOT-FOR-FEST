import { EVENT_FIELDS, type EventDetails } from "./event-fields";

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Returns an error response if the organiser PIN is wrong, or null if the request may continue.
export function checkPin(request: Request) {
  const pin = process.env.ORGANISER_PIN;
  if (pin && request.headers.get("x-organiser-pin") !== pin) {
    return jsonError("Incorrect organiser PIN.", 401);
  }
  return null;
}

// Keeps only known fields, so a request can't store anything else.
export function cleanEvent(body: unknown): EventDetails {
  const source = (body ?? {}) as Record<string, unknown>;
  const entries = EVENT_FIELDS.map((field) => {
    const value = source[field];
    return [field, typeof value === "string" ? value.trim().slice(0, 2000) : ""];
  });
  return Object.fromEntries(entries) as EventDetails;
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
