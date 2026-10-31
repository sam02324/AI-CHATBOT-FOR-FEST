import { jsonError, readJson } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { logError } from "@/lib/errors";
import { enforceLimits, LIMITS } from "@/lib/rate-limit";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_PATH_LENGTH = 300;

// Receives errors from people's browsers, sent by app/error.tsx and app/global-error.tsx.
export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);

  const limited = await enforceLimits(userId, LIMITS.errorReport);
  if (limited) return limited;

  const { message, path } = ((await readJson(request)) ?? {}) as { message?: unknown; path?: unknown };
  const cleanMessage = typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!cleanMessage) return jsonError("An error message is required.", 400);
  // Search text could be personal data, so the query string is never stored.
  const cleanPath = typeof path === "string" ? path.split("?")[0].slice(0, MAX_PATH_LENGTH) : "";

  await logError("browser", cleanMessage, { path: cleanPath });
  return new Response(null, { status: 204 });
}
