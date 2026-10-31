import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/errors/route";
import { onRequestError } from "@/instrumentation";
import { closeDb, db } from "@/lib/db";
import { listRecentErrors, logError } from "@/lib/errors";
import { countRows, loggedErrors, useTestDatabase } from "./helpers/db";
import { request } from "./helpers/http";
import { knownBug } from "./helpers/known-bug";
import { signInAs, signOut } from "./helpers/people";

useTestDatabase();

const MID_HOUR = Date.UTC(2026, 10, 14, 12, 30, 30);

function report(body: unknown) {
  return POST(request("/api/errors", "POST", body));
}

const SERVER_REQUEST = { path: "/api/chat?q=my+secret", method: "POST", headers: {} };
const SERVER_CONTEXT = { routerKind: "App Router", routePath: "/api/chat", routeType: "route", renderSource: undefined };

function serverError(error: unknown, requestInfo: object = SERVER_REQUEST) {
  return onRequestError!(error, requestInfo as never, SERVER_CONTEXT as never);
}

// Each of these points db() at a database that can't be used, until the test ends.
const NO_DATABASE = [
  {
    name: "there's no connection string",
    apply() {
      delete process.env.DATABASE_URL;
    },
  },
  {
    name: "nothing is listening",
    apply() {
      process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:9/postgres";
    },
  },
];
const realUrl = process.env.DATABASE_URL;

describe("logError", () => {
  test("writes a row", async () => {
    await logError("chat", new Error("Something broke"), { digest: "abc123", path: "/chat" });
    const [row] = await loggedErrors();
    expect(row).toMatchObject({ source: "chat", message: "Something broke", digest: "abc123", path: "/chat" });
    expect(row.stack).toContain("Something broke");
  });

  test("also writes to the server logs", async () => {
    const error = new Error("Something broke");
    await logError("chat", error);
    expect(console.error).toHaveBeenCalledWith("[chat]", error);
  });

  test("uses empty details by default", async () => {
    await logError("chat", new Error("Something broke"));
    const [row] = await loggedErrors();
    expect(row).toMatchObject({ digest: "", path: "" });
  });

  test("accepts things that aren't errors", async () => {
    await logError("chat", "just text");
    await logError("chat", 404);
    await logError("chat", null);
    await logError("chat", { reason: "odd" });
    const rows = await loggedErrors();
    expect(rows.map((row) => row.message)).toEqual(["just text", "404", "null", "[object Object]"]);
    expect(rows.every((row) => row.stack === "")).toBe(true);
  });

  test("cuts a long message and stack", async () => {
    const error = new Error("m".repeat(5000));
    error.stack = "s".repeat(9000);
    await logError("chat", error);
    const [row] = await loggedErrors();
    expect(row.message).toHaveLength(1000);
    expect(row.stack).toHaveLength(4000);
  });

  test("copes with an error with no stack", async () => {
    const error = new Error("No stack");
    delete error.stack;
    await logError("chat", error);
    const [row] = await loggedErrors();
    expect(row.stack).toBe("");
  });

  test("keeps tricky text as plain text", async () => {
    await logError("'); DROP TABLE error_log;--", new Error("'); DROP TABLE error_log;--"), { path: "'; --" });
    expect(await loggedErrors()).toMatchObject([{ source: "'); DROP TABLE error_log;--", message: "'); DROP TABLE error_log;--", path: "'; --" }]);
  });

  test("now and then removes rows older than 30 days, and no others", async () => {
    await db().unsafe(`
      INSERT INTO error_log (source, message, created_at) VALUES
        ('old', 'old', now() - interval '31 days'),
        ('recent', 'recent', now() - interval '29 days')`);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await logError("new", "first");
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["old", "recent", "new"]);

    vi.spyOn(Math, "random").mockReturnValue(0);
    await logError("new", "second");
    expect((await loggedErrors()).map((row) => row.source)).toEqual(["recent", "new", "new"]);
  });

  test("never throws when the table is gone", async () => {
    await db()`ALTER TABLE error_log RENAME TO error_log_hidden`;
    try {
      await expect(logError("chat", new Error("Something broke"))).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith("Couldn't record that error", expect.anything());
    } finally {
      await db()`ALTER TABLE error_log_hidden RENAME TO error_log`;
    }
  });

  test("never throws when text can't be stored", async () => {
    await expect(logError("chat", "before\u0000after")).resolves.toBeUndefined();
    expect(await countRows("error_log")).toBe(0);
  });

  describe.each(NO_DATABASE)("when $name", ({ apply }) => {
    beforeEach(async () => {
      await closeDb();
      apply();
    });

    afterEach(async () => {
      await closeDb();
      process.env.DATABASE_URL = realUrl;
    });

    test("never throws", async () => {
      await expect(logError("chat", new Error("Something broke"))).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith("[chat]", expect.any(Error));
      expect(console.error).toHaveBeenCalledWith("Couldn't record that error", expect.anything());
    });
  });

  // It promises it never throws, but only the database write is inside its try.
  describe("with values that are awkward to read", () => {
    knownBug("BUG: never throws for an object that can't become text", async () => {
      await expect(logError("chat", Object.create(null))).resolves.toBeUndefined();
    });

    knownBug("BUG: never throws for an error whose message isn't text", async () => {
      const error = new Error("x");
      (error as { message: unknown }).message = { code: 42 };
      await expect(logError("chat", error)).resolves.toBeUndefined();
    });

    knownBug("BUG: never throws for an error whose stack isn't text", async () => {
      const error = new Error("x");
      (error as { stack: unknown }).stack = { frames: [] };
      await expect(logError("chat", error)).resolves.toBeUndefined();
    });
  });
});

describe("listRecentErrors", () => {
  test("gives the latest 100, newest first", async () => {
    await db().unsafe(`
      INSERT INTO error_log (source, message)
      SELECT 'chat', 'Error ' || n FROM generate_series(1, 105) AS n`);
    const rows = await listRecentErrors();
    expect(rows).toHaveLength(100);
    expect(rows[0].message).toBe("Error 105");
    expect(rows[99].message).toBe("Error 6");
  });
});

describe("POST /api/errors", () => {
  test("requires sign-in", async () => {
    signOut();
    const response = await report({ message: "Oops" });
    expect(response.status).toBe(401);
    expect(await countRows("error_log")).toBe(0);
  });

  test("stores the message and path as a browser error", async () => {
    signInAs("attendant");
    const response = await report({ message: "  Oops  ", path: "/chat" });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await loggedErrors()).toEqual([{ source: "browser", message: "Oops", stack: "", digest: "", path: "/chat" }]);
  });

  test("strips the query string, which could hold personal data", async () => {
    signInAs("attendant");
    await report({ message: "Oops", path: "/tickets?email=someone@example.com&q=my+secret" });
    const [row] = await loggedErrors();
    expect(row.path).toBe("/tickets");
  });

  test("stores no stack, even if one is sent", async () => {
    signInAs("attendant");
    await report({ message: "Oops", stack: "at secretFunction (secret.js:1:1)", digest: "forged", source: "server:route" });
    expect(await loggedErrors()).toEqual([{ source: "browser", message: "Oops", stack: "", digest: "", path: "" }]);
  });

  test.each([[{}], [{ message: "" }], [{ message: "   " }], [{ message: 5 }], [{ message: null }], [null], [[]]])(
    "rejects %j",
    async (body) => {
      signInAs("attendant");
      const response = await report(body);
      expect(response.status).toBe(400);
      expect(await countRows("error_log")).toBe(0);
    },
  );

  test("rejects a body that isn't JSON", async () => {
    signInAs("attendant");
    const response = await POST(new Request("http://localhost/api/errors", { method: "POST", body: "{nope" }));
    expect(response.status).toBe(400);
  });

  test("cuts a long message and path", async () => {
    signInAs("attendant");
    await report({ message: "m".repeat(5000), path: `/${"p".repeat(1000)}` });
    const [row] = await loggedErrors();
    expect(row.message).toHaveLength(1000);
    expect(row.path).toHaveLength(300);
  });

  test("ignores a path that isn't text", async () => {
    signInAs("attendant");
    await report({ message: "Oops", path: { a: 1 } });
    const [row] = await loggedErrors();
    expect(row.path).toBe("");
  });

  test("the 21st report in an hour gets 429, and each person has their own count", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MID_HOUR);
    signInAs("attendant", { id: "user_noisy" });
    for (let index = 0; index < 20; index++) expect((await report({ message: "Oops" })).status).toBe(204);

    const response = await report({ message: "Oops" });
    expect(response.status).toBe(429);
    expect(await countRows("error_log")).toBe(20);

    signInAs("attendant", { id: "user_quiet" });
    expect((await report({ message: "Oops" })).status).toBe(204);
  });
});

describe("onRequestError in instrumentation.ts", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
  });

  test("records the error with its route type and digest", async () => {
    await serverError(Object.assign(new Error("Server broke"), { digest: "d1g3st" }));
    const [row] = await loggedErrors();
    expect(row).toMatchObject({ source: "server:route", message: "Server broke", digest: "d1g3st", path: "/api/chat" });
  });

  test("strips the query string", async () => {
    await serverError(new Error("Server broke"));
    const [row] = await loggedErrors();
    expect(row.path).toBe("/api/chat");
    expect(JSON.stringify(row)).not.toContain("my+secret");
  });

  test("copes with no digest, and with errors that aren't Error objects", async () => {
    await serverError(new Error("No digest"));
    await serverError("just text");
    await serverError(null);
    const rows = await loggedErrors();
    expect(rows.map((row) => row.message)).toEqual(["No digest", "just text", "null"]);
    expect(rows.every((row) => row.digest === "")).toBe(true);
  });

  test("does nothing outside Node.js", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await serverError(new Error("Server broke"));
    expect(await countRows("error_log")).toBe(0);
  });

  test("never throws when the request is missing its path", async () => {
    await expect(serverError(new Error("Server broke"), {})).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Couldn't record that error", expect.anything());
  });

  test("never throws for an error that can't become text", async () => {
    await expect(serverError(Object.create(null))).resolves.toBeUndefined();
  });

  describe.each(NO_DATABASE)("when $name", ({ apply }) => {
    beforeEach(async () => {
      await closeDb();
      apply();
    });

    afterEach(async () => {
      await closeDb();
      process.env.DATABASE_URL = realUrl;
    });

    test("never throws", async () => {
      await expect(serverError(new Error("Server broke"))).resolves.toBeUndefined();
    });
  });
});
