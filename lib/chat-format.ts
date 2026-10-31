// Shared by the chat page and the server, so this file must not import server-only code.

// The chatbot ends an answer with a line like [[events: a1b2c3d4, e5f6a7b8]] to show event cards.
const EVENT_MARKER = /\[\[\s*events?\s*:([^\]]*)\]\]/gi;
// Hides a marker that is still arriving while an answer streams in.
const PARTIAL_MARKER = /(?:\[\[\s*events?\s*:[^\]]*\]?|\[\[[^\]\n]*\]?|\[)$/i;
const MAX_CARDS = 3;
const LINK = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
// The last part has to be a real top-level domain, so "N.A" and "10.30" don't become links.
const BARE_DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+(?:[/?#]\S*)?$/i;

export type AnswerPart = { text: string } | { text: string; href: string };

// Separates what people should read from the event references behind it.
export function parseAnswer(raw: string) {
  const refs: string[] = [];
  const withoutMarkers = raw.replace(EVENT_MARKER, (_match, list: string) => {
    refs.push(...list.split(",").map((ref) => ref.trim()).filter(Boolean));
    return "";
  });
  return {
    text: withoutMarkers.replace(PARTIAL_MARKER, "").trimEnd(),
    refs: [...new Set(refs)].slice(0, MAX_CARDS),
  };
}

// Turns stored text such as "forms.gle/abc" into a link that is safe to open, or null if it isn't one.
export function safeLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (!hasScheme && !BARE_DOMAIN.test(trimmed)) return null;
  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// Splits an answer into plain text and links.
export function splitLinks(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let position = 0;
  for (const match of text.matchAll(LINK)) {
    const label = match[0].replace(TRAILING_PUNCTUATION, "");
    const href = safeLink(label);
    if (!href) continue;
    if (match.index > position) parts.push({ text: text.slice(position, match.index) });
    parts.push({ text: label, href });
    position = match.index + label.length;
  }
  if (position < text.length) parts.push({ text: text.slice(position) });
  return parts;
}

// Formats a stored YYYY-MM-DD date for people, such as "Sat, 14 Nov 2026".
export function formatEventDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(`${date}T00:00:00Z`);
  // new Date() rolls 30 February over to 2 March, so the result has to match what was stored.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return date;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
