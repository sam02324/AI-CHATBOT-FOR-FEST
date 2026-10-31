import type { Instrumentation } from "next";

// Records server errors in the error log organisers read at /organiser/errors.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // The database code only runs on Node.js, so importing it here keeps it out of other runtimes.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { logError } = await import("./lib/errors");
      const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
      // Search text could be personal data, so the query string is never stored.
      const path = request.path.split("?")[0];
      await logError(`server:${context.routeType}`, err, { digest, path });
    } catch (failure) {
      console.error("Couldn't record that error", failure);
    }
  }
};
