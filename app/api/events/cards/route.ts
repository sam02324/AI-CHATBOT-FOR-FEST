import { jsonError } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { listEvents } from "@/lib/db";
import { eventRef, type EventCard } from "@/lib/event-fields";

export const dynamic = "force-dynamic";

// Anyone signed in can see these, so this lists each field by name to keep the rest of an event out.
export async function GET() {
  const userId = await getUserId();
  if (!userId) return jsonError("Please sign in.", 401);

  const events = await listEvents();
  const cards: EventCard[] = events.map((event) => ({
    ref: eventRef(event.id),
    name: event.name,
    category: event.category,
    date: event.date,
    start_time: event.start_time,
    end_time: event.end_time,
    venue: event.venue,
    fee: event.fee,
    registration_link: event.registration_link,
  }));
  return Response.json(cards);
}
