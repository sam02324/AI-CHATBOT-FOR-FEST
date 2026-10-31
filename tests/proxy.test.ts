import { describe, expect, test, vi } from "vitest";
import proxy from "@/proxy";

// Clerk's own matching is real. Only the wrapper is replaced, to get at the rule proxy.ts gives it.
vi.mock("@clerk/nextjs/server", async () => {
  const { createRouteMatcher } = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return { createRouteMatcher, clerkMiddleware: (rule: unknown) => rule };
});

type Rule = (auth: { protect: () => Promise<void> }, request: unknown) => Promise<void>;

async function isProtected(pathname: string) {
  const protect = vi.fn(async () => {});
  await (proxy as unknown as Rule)({ protect }, { nextUrl: new URL(`http://localhost${pathname}`) });
  return protect.mock.calls.length > 0;
}

describe("proxy.ts", () => {
  test.each(["/", "/chat", "/tickets", "/organiser", "/organiser/tickets", "/organiser/team", "/organiser/errors"])(
    "the page %s needs a login",
    async (pathname) => {
      expect(await isProtected(pathname)).toBe(true);
    },
  );

  test.each(["/sign-in", "/sign-in/factor-one", "/sign-up", "/sign-up/verify-email-address"])(
    "%s stays open, or nobody could sign in",
    async (pathname) => {
      expect(await isProtected(pathname)).toBe(false);
    },
  );

  // These return their own 401s, which the permission tests check. A redirect would break the page's fetch.
  test.each(["/api/chat", "/api/tickets", "/api/tickets/TKT-AAAA2222/messages", "/api/team"])(
    "the API route %s is left to check for itself",
    async (pathname) => {
      expect(await isProtected(pathname)).toBe(false);
    },
  );
});
