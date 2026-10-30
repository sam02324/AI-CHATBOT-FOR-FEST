import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { checkPin, jsonError, readJson } from "@/lib/api";
import { apiErrorMessage, FALLBACK_BETA, getClient, MODEL, NO_KEY_MESSAGE, PosterSchema, posterPrompt } from "@/lib/claude";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_IMAGE_BASE64_LENGTH = 5 * 1024 * 1024;

// Reads a poster and returns the fields for the organiser to check. Nothing is saved here.
export async function POST(request: Request) {
  const denied = checkPin(request);
  if (denied) return denied;

  const { image, mediaType } = ((await readJson(request)) ?? {}) as { image?: unknown; mediaType?: unknown };
  const imageType = IMAGE_TYPES.find((type) => type === mediaType);
  if (typeof image !== "string" || !image || !imageType) {
    return jsonError("Please upload a JPG, PNG, WebP or GIF image.", 400);
  }
  if (image.length > MAX_IMAGE_BASE64_LENGTH) return jsonError("That image is too large.", 413);

  const client = getClient();
  if (!client) return jsonError(NO_KEY_MESSAGE, 503);

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(PosterSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: imageType, data: image } },
            { type: "text", text: posterPrompt() },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return jsonError("Couldn't read that poster. Please enter the details manually.", 422);
    }
    if (!response.parsed_output.is_event_poster) {
      return jsonError("That doesn't look like an event poster. Try another image or enter the details manually.", 422);
    }
    return Response.json(response.parsed_output);
  } catch (error) {
    console.error(error);
    return jsonError(apiErrorMessage(error), 502);
  }
}
