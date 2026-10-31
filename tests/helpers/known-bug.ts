import { test } from "vitest";

// A test for a bug in the app that hasn't been fixed yet. It passes while the bug is there and
// fails once the bug is gone, as a reminder to change it to a plain test.
// Run with SHOW_KNOWN_BUGS=1 to see these fail with their real messages.
export const knownBug = process.env.SHOW_KNOWN_BUGS ? test : test.fails;
