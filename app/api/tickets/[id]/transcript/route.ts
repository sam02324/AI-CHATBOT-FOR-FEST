import { jsonError } from "@/lib/api";
import { denyUnlessStaff } from "@/lib/auth";
import { getTicketTranscript } from "@/lib/tickets";

type Context = { params: Promise<{ id: string }> };

// The chat a ticket came from. Only staff need this, because attendants already have their own chat.
export async function GET(_request: Request, { params }: Context) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const transcript = await getTicketTranscript((await params).id);
  return transcript ? Response.json(transcript) : jsonError("Ticket not found.", 404);
}
