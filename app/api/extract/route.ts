import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { jsonError, readJson } from "@/lib/api";
import { denyUnlessStaff, getUserId } from "@/lib/auth";
import { apiErrorMessage, getClient, MODEL, NO_KEY_MESSAGE, PosterSchema, posterPrompt } from "@/lib/claude";
import { logError } from "@/lib/errors";
import { enforceAiLimits, LIMITS } from "@/lib/rate-limit";

export const maxDuration = 60;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_IMAGES = 5;
// Vercel rejects request bodies over about 4.5 MB.
const MAX_TOTAL_BASE64_LENGTH = 4.4 * 1024 * 1024;
const UNREADABLE_MESSAGE = "Couldn't read that. Please enter the details manually.";

// Reads one or more posters and returns the fields for the organiser to check. Nothing is saved here.
export async function POST(request: Request) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const { images } = ((await readJson(request)) ?? {}) as { images?: { data?: unknown; mediaType?: unknown }[] };
  if (!Array.isArray(images) || images.length === 0) return jsonError("Please upload a poster.", 400);
  if (images.length > MAX_IMAGES) return jsonError(`Please upload up to ${MAX_IMAGES} posters at a time.`, 400);

  const content = [];
  let totalLength = 0;
  for (const image of images) {
    const mediaType = IMAGE_TYPES.find((type) => type === image?.mediaType);
    if (typeof image?.data !== "string" || !image.data || !mediaType) {
      return jsonError("Please upload JPG, PNG, WebP or GIF images.", 400);
    }
    totalLength += image.data.length;
    content.push({ type: "image" as const, source: { type: "base64" as const, media_type: mediaType, data: image.data } });
  }
  if (totalLength > MAX_TOTAL_BASE64_LENGTH) return jsonError("Those images are too large. Try fewer posters.", 413);

  const client = getClient();
  if (!client) return jsonError(NO_KEY_MESSAGE, 503);

  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);
  const limited = await enforceAiLimits(userId, LIMITS.poster);
  if (limited) return limited;

  try {
    const response = await client.messages.parse(
      {
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium", format: zodOutputFormat(PosterSchema) },
        messages: [{ role: "user", content: [...content, { type: "text", text: posterPrompt(images.length) }] }],
      },
      { timeout: 50_000, maxRetries: 0, signal: AbortSignal.timeout(50_000) },
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return jsonError(UNREADABLE_MESSAGE, 422);
    }
    if (!response.parsed_output.is_event_poster) {
      return jsonError("That doesn't look like an event poster. Try another image or enter the details manually.", 422);
    }
    if (!response.parsed_output.same_event) {
      return jsonError("These posters look like different events. Please add one event at a time.", 422);
    }
    return Response.json(response.parsed_output);
  } catch (error) {
    await logError("poster", error);
    // The SDK throws a plain AnthropicError, not an APIError, when a reply isn't valid JSON.
    if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
      return jsonError(UNREADABLE_MESSAGE, 422);
    }
    return jsonError(apiErrorMessage(error), 502);
  }
}
