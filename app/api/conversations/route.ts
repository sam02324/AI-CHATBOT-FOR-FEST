import { jsonError } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);
  return Response.json(await listConversations(userId));
}
