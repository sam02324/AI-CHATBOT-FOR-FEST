import { cleanEvent, jsonError, readJson } from "@/lib/api";
import { denyUnlessOrganiser } from "@/lib/auth";
import { createEvent, listEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await denyUnlessOrganiser();
  if (denied) return denied;

  return Response.json(await listEvents());
}

export async function POST(request: Request) {
  const denied = await denyUnlessOrganiser();
  if (denied) return denied;

  const details = cleanEvent(await readJson(request));
  if (!details.name) return jsonError("Event name is required.", 400);
  return Response.json(await createEvent(details), { status: 201 });
}
