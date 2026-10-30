import { cleanEvent, jsonError, readJson } from "@/lib/api";
import { denyUnlessStaff } from "@/lib/auth";
import { deleteEvent, updateEvent } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const details = cleanEvent(await readJson(request));
  if (!details.name) return jsonError("Event name is required.", 400);
  const updated = await updateEvent((await params).id, details);
  return updated ? Response.json(updated) : jsonError("Event not found.", 404);
}

export async function DELETE(request: Request, { params }: Context) {
  const denied = await denyUnlessStaff();
  if (denied) return denied;

  const deleted = await deleteEvent((await params).id);
  return deleted ? new Response(null, { status: 204 }) : jsonError("Event not found.", 404);
}
