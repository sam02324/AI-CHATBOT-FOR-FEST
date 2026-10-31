import { afterEach, beforeEach, inject, vi } from "vitest";
import { isLocalHost } from "./helpers/local";
import { resetPeople } from "./helpers/people";

// Runs before each test file's imports, so nothing can connect anywhere else first.
process.env.DATABASE_URL = inject("testDatabaseUrl");

vi.mock("@clerk/nextjs/server", async () => (await import("./helpers/people")).clerkServer);

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (!isLocalHost(url.hostname)) throw new Error(`Tests must not use the network: ${url.href}`);
  return realFetch(input, init);
};

beforeEach(() => {
  resetPeople();
  // logError writes to the console on purpose. Tests that care look at this spy.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
