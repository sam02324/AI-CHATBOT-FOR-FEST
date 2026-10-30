import { jsonError } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { deleteConversation, getMessages } from "@/lib/conversations";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);
  const messages = await getMessages((await params).id, userId);
  return messages ? Response.json(messages) : jsonError("Conversation not found.", 404);
}

export async function DELETE(_request: Request, { params }: Context) {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);
  const deleted = await deleteConversation((await params).id, userId);
  return deleted ? new Response(null, { status: 204 }) : jsonError("Conversation not found.", 404);
}
