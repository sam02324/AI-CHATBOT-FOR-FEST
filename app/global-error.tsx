"use client";

import { useEffect } from "react";

// The same report as app/error.tsx. This page replaces the whole app, so it keeps its own copy.
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

// Shown when the root layout fails. Global styles don't apply here, so the void black colours are inline.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportBrowserError(error);
  }, [error]);

  return (
    <html lang="en" style={{ background: "#000000", colorScheme: "dark" }}>
      <head>
        <title>Something went wrong</title>
        {/* The root layout's viewport setting is gone too, and phones need one to size the page. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          background: "#000000",
          color: "#f5f5f7",
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          lineHeight: 1.5,
        }}
      >
        <main
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            boxSizing: "border-box",
            minHeight: "100dvh",
            padding: 16,
            textAlign: "center",
          }}
        >
          <div role="alert">
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.025em" }}>
              Something went wrong
            </h1>
            <p style={{ margin: "8px 0 0", color: "#a6a6ad" }}>
              You can try again. If it keeps happening, please come back a little later.
            </p>
          </div>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: "0 20px",
              border: "none",
              borderRadius: 9999,
              background: "#ff6a2b",
              color: "#000000",
              fontFamily: "inherit",
              fontSize: 16,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
