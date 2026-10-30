import { checkPin, cleanEvent, jsonError, readJson } from "@/lib/api";
import { createEvent, listEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(listEvents());
}

export async function POST(request: Request) {
  const denied = checkPin(request);
  if (denied) return denied;

  const details = cleanEvent(await readJson(request));
  if (!details.name) return jsonError("Event name is required.", 400);
  return Response.json(createEvent(details), { status: 201 });
}
