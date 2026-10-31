import { EVENT_FIELDS, type CustomSection, type EventDetails } from "./event-fields";

const MAX_CUSTOM_SECTIONS = 20;

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Postgres can't store a NUL character in text, so those are removed too.
export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replaceAll("\0", "").trim().slice(0, maxLength) : "";
}

// Keeps only sections with both a heading and details.
function cleanSections(value: unknown): CustomSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((section) => ({ title: cleanText(section?.title, 100), content: cleanText(section?.content, 5000) }))
    .filter((section) => section.title && section.content)
    .slice(0, MAX_CUSTOM_SECTIONS);
}

// Keeps only known fields, so a request can't store anything else.
export function cleanEvent(body: unknown): EventDetails {
  const source = (body ?? {}) as Record<string, unknown>;
  const entries = EVENT_FIELDS.map((field) => [field, cleanText(source[field], 2000)]);
  return { ...Object.fromEntries(entries), custom_sections: cleanSections(source.custom_sections) } as EventDetails;
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
