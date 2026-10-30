import { db } from "./db";
import type { ChatMessage, ConversationSummary } from "./roles";

const TITLE_LENGTH = 60;

export async function listConversations(userId: string) {
  const sql = await db();
  const rows = await sql`
    SELECT id, title, updated_at FROM conversations
    WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 50`;
  return rows as unknown as ConversationSummary[];
}

// Returns null unless the conversation belongs to this user.
export async function getMessages(conversationId: string, userId: string) {
  const sql = await db();
  const owner = await sql`SELECT 1 FROM conversations WHERE id = ${conversationId} AND user_id = ${userId}`;
  if (owner.length === 0) return null;
  const rows = await sql`
    SELECT role, content FROM chat_messages WHERE conversation_id = ${conversationId} ORDER BY id`;
  return rows as unknown as ChatMessage[];
}

export async function saveExchange(conversationId: string, userId: string, question: string, answer: string) {
  const sql = await db();
  const owned = await sql`
    INSERT INTO conversations (id, user_id, title) VALUES (${conversationId}, ${userId}, ${question.slice(0, TITLE_LENGTH)})
    ON CONFLICT (id) DO UPDATE SET updated_at = now() WHERE conversations.user_id = ${userId}
    RETURNING id`;
  // No row comes back if this conversation belongs to someone else.
  if (owned.length === 0) return;
  await sql`
    INSERT INTO chat_messages (conversation_id, role, content)
    VALUES (${conversationId}, 'user', ${question}), (${conversationId}, 'assistant', ${answer})`;
}

export async function deleteConversation(conversationId: string, userId: string) {
  const sql = await db();
  const result = await sql`DELETE FROM conversations WHERE id = ${conversationId} AND user_id = ${userId}`;
  return result.count > 0;
}
