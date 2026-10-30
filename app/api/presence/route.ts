import { jsonError } from "@/lib/api";
import { denyUnlessStaff, getUserId } from "@/lib/auth";
import { isStaffOnline, markStaffOnline } from "@/lib/tickets";

// Tells the chat whether someone is available for a live conversation.
export async function GET() {
  if (!(await getUserId())) return jsonError("Please sign in.", 401);
  return Response.json({ online: await isStaffOnline() });
}

// The staff Tickets page calls this regularly while it's open.
export async function POST() {
  const denied = await denyUnlessStaff();
  if (denied) return denied;
  await markStaffOnline((await getUserId()) ?? "");
  return new Response(null, { status: 204 });
}
