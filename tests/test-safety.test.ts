import { describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import { clearTables, useTestDatabase } from "./helpers/db";
import { assertLocalDatabase } from "./helpers/local";

// Checks the guards that keep the tests away from real data and real services.

useTestDatabase();

describe("assertLocalDatabase", () => {
  test.each([
    ["postgres://postgres:postgres@127.0.0.1:5432/postgres"],
    ["postgres://postgres:postgres@localhost:5432/postgres"],
    ["postgresql://u:p@[::1]:5432/postgres"],
  ])("allows %s", (url) => {
    expect(() => assertLocalDatabase(url)).not.toThrow();
  });

  test.each([
    ["postgres://u:p@ep-cool-name.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"],
    ["postgres://postgres:p@db.abcdefgh.supabase.co:5432/postgres"],
    ["postgres://u:p@localhost.example.com/postgres"],
    ["postgres://localhost:p@db.example.com/postgres"],
    ["postgres://u:p@127.0.0.1.example.com/postgres"],
    ["not a url"],
    [""],
    [undefined],
  ])("refuses %s", (url) => {
    expect(() => assertLocalDatabase(url)).toThrow("Refusing");
  });
});

describe("clearTables", () => {
  test("refuses to clear anything if DATABASE_URL isn't local", async () => {
    await db()`INSERT INTO staff_presence (user_id) VALUES ('keep-me')`;
    vi.stubEnv("DATABASE_URL", "postgres://u:p@ep-cool-name.neon.tech/neondb");

    await expect(clearTables()).rejects.toThrow("Refusing");

    vi.unstubAllEnvs();
    expect(await db()`SELECT user_id FROM staff_presence`).toEqual([{ user_id: "keep-me" }]);
  });

  test("empties every table except the record of migrations", async () => {
    await db()`INSERT INTO staff_presence (user_id) VALUES ('someone')`;
    await db()`INSERT INTO error_log (source, message) VALUES ('a', 'b')`;

    await clearTables();

    expect(await db()`SELECT 1 FROM staff_presence`).toHaveLength(0);
    expect(await db()`SELECT 1 FROM error_log`).toHaveLength(0);
    expect((await db()`SELECT 1 FROM schema_migrations`).length).toBeGreaterThan(0);
  });
});

describe("the test environment", () => {
  test("points at the local database and a local, fake AI service", () => {
    expect(() => assertLocalDatabase(process.env.DATABASE_URL)).not.toThrow();
    expect(process.env.ANTHROPIC_API_KEY).toBe("test-key-not-real");
    expect(new URL(process.env.ANTHROPIC_BASE_URL!).hostname).toBe("127.0.0.1");
  });

  test("the tables came from the real migrations", async () => {
    const rows = await db()`SELECT version FROM schema_migrations`;
    expect(rows.length).toBeGreaterThan(0);
  });

  test("fetch refuses to leave this computer", async () => {
    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow("must not use the network");
    await expect(fetch(new Request("https://example.com/"))).rejects.toThrow("must not use the network");
  });
});
