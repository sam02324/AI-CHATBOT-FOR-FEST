import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { closeDb, db } from "@/lib/db";
import { enforceAiLimits, enforceLimits, LIMITS } from "@/lib/rate-limit";
import { loggedErrors, useTestDatabase } from "./helpers/db";

useTestDatabase();

// 12:30:30 UTC, so a minute window has 30 seconds left, an hour 1770 and a day 41370.
const NOW = Date.UTC(2026, 10, 14, 12, 30, 30);
const NOW_SECONDS = NOW / 1000;

function freezeClock(time = NOW) {
  vi.spyOn(Date, "now").mockReturnValue(time);
}

const THREE_A_MINUTE = [{ name: "test-minute", max: 3, windowSeconds: 60 }];

async function hits(key: string) {
  const rows = await db()`SELECT coalesce(sum(hits), 0)::int AS total FROM rate_limits WHERE key = ${key}`;
  return rows[0].total as number;
}

// Sets how much of today's shared budget is already used.
async function useSharedBudget(count: number) {
  const windowStart = NOW_SECONDS - (NOW_SECONDS % 86400);
  await db()`INSERT INTO rate_limits (key, window_start, hits) VALUES ('ai-all-day:app', ${windowStart}, ${count})`;
}

describe("per-person limits", () => {
  beforeEach(() => freezeClock());

  test("allow up to the limit and then give 429", async () => {
    expect(await enforceLimits("user_a", THREE_A_MINUTE)).toBeNull();
    expect(await enforceLimits("user_a", THREE_A_MINUTE)).toBeNull();
    expect(await enforceLimits("user_a", THREE_A_MINUTE)).toBeNull();

    const response = await enforceLimits("user_a", THREE_A_MINUTE);

    expect(response?.status).toBe(429);
    expect(await response?.json()).toEqual({ error: "You're doing that too quickly. Please try again in about 30 seconds." });
  });

  test("keep each person separate", async () => {
    for (let index = 0; index < 4; index++) await enforceLimits("user_a", THREE_A_MINUTE);
    expect((await enforceLimits("user_a", THREE_A_MINUTE))?.status).toBe(429);
    expect(await enforceLimits("user_b", THREE_A_MINUTE)).toBeNull();
  });

  test("keep each kind of limit separate", async () => {
    const other = [{ name: "test-other", max: 1, windowSeconds: 60 }];
    for (let index = 0; index < 4; index++) await enforceLimits("user_a", THREE_A_MINUTE);
    expect(await enforceLimits("user_a", other)).toBeNull();
  });

  test.each([
    { windowSeconds: 60, retryAfter: "30", wait: "about 30 seconds" },
    { windowSeconds: 3600, retryAfter: "1770", wait: "about 30 minutes" },
    { windowSeconds: 86400, retryAfter: "41370", wait: "about 12 hours" },
  ])("say how long to wait in a $windowSeconds second window", async ({ windowSeconds, retryAfter, wait }) => {
    const limit = [{ name: "test", max: 0, windowSeconds }];
    const response = await enforceLimits("user_a", limit);
    expect(response?.headers.get("Retry-After")).toBe(retryAfter);
    expect((await response?.json()).error).toContain(wait);
  });

  test("Retry-After is at least 1 at the very end of a window", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW + 29_999);
    const response = await enforceLimits("user_a", [{ name: "test", max: 0, windowSeconds: 60 }]);
    expect(response?.headers.get("Retry-After")).toBe("1");
  });

  test("start again in the next window", async () => {
    for (let index = 0; index < 4; index++) await enforceLimits("user_a", THREE_A_MINUTE);
    expect((await enforceLimits("user_a", THREE_A_MINUTE))?.status).toBe(429);

    vi.spyOn(Date, "now").mockReturnValue(NOW + 30_000);
    expect(await enforceLimits("user_a", THREE_A_MINUTE)).toBeNull();
  });

  test("check several limits at once and give the longest wait", async () => {
    const limits = [
      { name: "test-minute", max: 0, windowSeconds: 60 },
      { name: "test-hour", max: 0, windowSeconds: 3600 },
    ];
    const response = await enforceLimits("user_a", limits);
    expect(response?.headers.get("Retry-After")).toBe("1770");
    expect(await hits("test-minute:user_a")).toBe(1);
    expect(await hits("test-hour:user_a")).toBe(1);
  });

  test("the longer limit still blocks once the shorter one has passed", async () => {
    const dayWindow = NOW_SECONDS - (NOW_SECONDS % 86400);
    await db()`INSERT INTO rate_limits (key, window_start, hits) VALUES ('chat-day:user_a', ${dayWindow}, 200)`;
    const response = await enforceLimits("user_a", LIMITS.chat);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("41370");
  });

  test("hold when many requests arrive at once", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => enforceLimits("user_a", THREE_A_MINUTE)));
    expect(results.filter((result) => result === null)).toHaveLength(3);
    expect(results.filter((result) => result?.status === 429)).toHaveLength(9);
  });

  test("the documented limits are what the app uses", () => {
    expect(LIMITS).toEqual({
      chat: [
        { name: "chat-minute", max: 15, windowSeconds: 60 },
        { name: "chat-day", max: 200, windowSeconds: 86400 },
      ],
      poster: [{ name: "poster-hour", max: 30, windowSeconds: 3600 }],
      ticket: [{ name: "ticket-hour", max: 5, windowSeconds: 3600 }],
      ticketMessage: [{ name: "ticket-message-minute", max: 30, windowSeconds: 60 }],
      errorReport: [{ name: "error-report-hour", max: 20, windowSeconds: 3600 }],
    });
  });

  test("old counts get cleaned up now and then, and recent ones stay", async () => {
    await db()`INSERT INTO rate_limits (key, window_start, hits) VALUES ('old:user', ${NOW_SECONDS - 3 * 86400}, 9)`;
    await db()`INSERT INTO rate_limits (key, window_start, hits) VALUES ('recent:user', ${NOW_SECONDS - 86400}, 9)`;

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await enforceLimits("user_a", THREE_A_MINUTE);
    expect(await hits("old:user")).toBe(9);

    vi.spyOn(Math, "random").mockReturnValue(0);
    await enforceLimits("user_a", THREE_A_MINUTE);
    expect(await hits("old:user")).toBe(0);
    expect(await hits("recent:user")).toBe(9);
  });
});

describe("the shared AI budget", () => {
  beforeEach(() => freezeClock());

  test("counts every person's requests together", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "2");
    expect(await enforceAiLimits("user_a", THREE_A_MINUTE)).toBeNull();
    expect(await enforceAiLimits("user_b", THREE_A_MINUTE)).toBeNull();

    const response = await enforceAiLimits("user_c", THREE_A_MINUTE);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("41370");
    expect((await response?.json()).error).toContain("reached its limit for today");
    expect(await hits("ai-all-day:app")).toBe(3);
  });

  test("a person over their own limit doesn't use it up", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "5");
    for (let index = 0; index < 3; index++) await enforceAiLimits("user_a", THREE_A_MINUTE);
    expect(await hits("ai-all-day:app")).toBe(3);

    for (let index = 0; index < 20; index++) {
      const response = await enforceAiLimits("user_a", THREE_A_MINUTE);
      expect(response?.status).toBe(429);
      expect((await response?.json()).error).toContain("too quickly");
    }

    expect(await hits("ai-all-day:app")).toBe(3);
    expect(await enforceAiLimits("user_b", THREE_A_MINUTE)).toBeNull();
  });

  test("defaults to 2000 a day", async () => {
    await useSharedBudget(1999);
    expect(await enforceAiLimits("user_a", THREE_A_MINUTE)).toBeNull();
    expect((await enforceAiLimits("user_b", THREE_A_MINUTE))?.status).toBe(429);
  });

  test.each(["", "abc", "0", "-5"])("ignores the setting %j and uses the default", async (setting) => {
    vi.stubEnv("AI_DAILY_LIMIT", setting);
    await useSharedBudget(1999);
    expect(await enforceAiLimits("user_a", THREE_A_MINUTE)).toBeNull();
    expect((await enforceAiLimits("user_b", THREE_A_MINUTE))?.status).toBe(429);
  });

  test("uses a higher setting", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "5000");
    await useSharedBudget(4000);
    expect(await enforceAiLimits("user_a", THREE_A_MINUTE)).toBeNull();
  });
});

describe("when the database has a problem", () => {
  describe("with the rate_limits table", () => {
    beforeEach(async () => {
      await db()`ALTER TABLE rate_limits RENAME TO rate_limits_hidden`;
    });

    afterEach(async () => {
      await db()`ALTER TABLE rate_limits_hidden RENAME TO rate_limits`;
    });

    test("enforceLimits lets the request through and logs it", async () => {
      expect(await enforceLimits("user_a", THREE_A_MINUTE)).toBeNull();
      expect(await loggedErrors()).toMatchObject([{ source: "rate-limit" }]);
    });

    test("enforceAiLimits lets the request through and logs it", async () => {
      expect(await enforceAiLimits("user_a", THREE_A_MINUTE)).toBeNull();
      expect((await loggedErrors()).map((row) => row.source)).toEqual(["rate-limit", "rate-limit"]);
    });
  });

  describe("with no database at all", () => {
    const realUrl = process.env.DATABASE_URL;

    beforeEach(async () => {
      await closeDb();
    });

    afterEach(async () => {
      await closeDb();
      process.env.DATABASE_URL = realUrl;
    });

    test("no connection string: both let the request through", async () => {
      delete process.env.DATABASE_URL;
      expect(await enforceLimits("user_a", THREE_A_MINUTE)).toBeNull();
      expect(await enforceAiLimits("user_a", THREE_A_MINUTE)).toBeNull();
      expect(console.error).toHaveBeenCalledWith("[rate-limit]", expect.anything());
    });

    test("nothing listening: both let the request through", async () => {
      process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:9/postgres";
      expect(await enforceLimits("user_a", THREE_A_MINUTE)).toBeNull();
      expect(await enforceAiLimits("user_a", THREE_A_MINUTE)).toBeNull();
      expect(console.error).toHaveBeenCalledWith("[rate-limit]", expect.anything());
    });
  });
});
