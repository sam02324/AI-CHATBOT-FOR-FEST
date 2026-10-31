import { db } from "./db";
import { logError } from "./errors";

type Limit = { name: string; max: number; windowSeconds: number };

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
// Stops the whole app's AI use at a fixed daily number, because one person can create many accounts.
const DEFAULT_AI_DAILY_LIMIT = 2000;
const CLEANUP_CHANCE = 0.01;

// Limits for each person.
export const LIMITS = {
  chat: [
    { name: "chat-minute", max: 15, windowSeconds: MINUTE },
    { name: "chat-day", max: 200, windowSeconds: DAY },
  ],
  poster: [{ name: "poster-hour", max: 30, windowSeconds: HOUR }],
  ticket: [{ name: "ticket-hour", max: 5, windowSeconds: HOUR }],
  ticketMessage: [{ name: "ticket-message-minute", max: 30, windowSeconds: MINUTE }],
  errorReport: [{ name: "error-report-hour", max: 20, windowSeconds: HOUR }],
} satisfies Record<string, Limit[]>;

function aiDailyLimit(): Limit {
  const configured = Number(process.env.AI_DAILY_LIMIT);
  return { name: "ai-all-day", max: configured > 0 ? configured : DEFAULT_AI_DAILY_LIMIT, windowSeconds: DAY };
}

function waitText(seconds: number) {
  if (seconds < 90) return `about ${seconds} seconds`;
  if (seconds < 90 * 60) return `about ${Math.ceil(seconds / 60)} minutes`;
  return `about ${Math.ceil(seconds / 3600)} hours`;
}

function tooMany(message: string, retryAfterSeconds: number) {
  return Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// Adds one hit to each limit in a single atomic query. Returns how long to wait if any is exceeded.
async function recordHits(limits: Limit[], suffix: string) {
  const sql = db();
  const now = Math.floor(Date.now() / 1000);
  const entries = limits.map((limit) => ({
    key: `${limit.name}:${suffix}`,
    window_start: now - (now % limit.windowSeconds),
  }));
  const rows = await sql`
    INSERT INTO rate_limits ${sql(entries, "key", "window_start")}
    ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
    RETURNING key, hits`;
  const hits = new Map(rows.map((row) => [row.key as string, row.hits as number]));

  if (Math.random() < CLEANUP_CHANCE) {
    await sql`DELETE FROM rate_limits WHERE window_start < ${now - 2 * DAY}`;
  }

  let wait = 0;
  limits.forEach((limit, index) => {
    const entry = entries[index];
    if ((hits.get(entry.key) ?? 0) > limit.max) {
      wait = Math.max(wait, Math.max(1, entry.window_start + limit.windowSeconds - now));
    }
  });
  return wait;
}

// Returns a 429 response if this person is over a limit, or null if the request may continue.
// If checking fails, the request continues, so a problem here can't take the whole app down.
export async function enforceLimits(userId: string, limits: Limit[]): Promise<Response | null> {
  try {
    const wait = await recordHits(limits, userId);
    return wait > 0 ? tooMany(`You're doing that too quickly. Please try again in ${waitText(wait)}.`, wait) : null;
  } catch (error) {
    await logError("rate-limit", error);
    return null;
  }
}

// The same check for requests that cost AI credits. Someone already over their own limit
// isn't counted against the shared budget, so one person can't use it up for everyone.
export async function enforceAiLimits(userId: string, limits: Limit[]): Promise<Response | null> {
  const personal = await enforceLimits(userId, limits);
  if (personal) return personal;
  try {
    const wait = await recordHits([aiDailyLimit()], "app");
    return wait > 0
      ? tooMany("The AI assistant has reached its limit for today. Tap Talk to a person if you need help.", wait)
      : null;
  } catch (error) {
    await logError("rate-limit", error);
    return null;
  }
}
