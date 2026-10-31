"use client";

import Link from "next/link";
import { useEffect } from "react";

async function reportBrowserError(error: unknown) {
  try {
    // A digest means it happened on the server, where instrumentation.ts has already recorded it.
    if (typeof error === "object" && error !== null && "digest" in error && error.digest) return;
    const message = (error instanceof Error ? error.message : String(error)) || "Unknown error";
    await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive refuses bodies over 64 KB, and the server only keeps this much of the message anyway.
      body: JSON.stringify({ message: message.slice(0, 1000), path: location.pathname }),
      keepalive: true,
    });
  } catch {
    // Reporting is best effort, so a failure here stays silent.
  }
}

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportBrowserError(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4 text-center">
      <div role="alert">
        <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-muted">You can try again. If it keeps happening, please come back a little later.</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="min-h-11 rounded-full bg-accent px-5 font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
        {/* Home redirects to /chat or /organiser. If the error is on that page, the path doesn't change, so this clears it. */}
        <Link
          href="/"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center rounded-full border border-control-line px-5 font-medium transition-colors hover:bg-accent-soft"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
