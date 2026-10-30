import { clerkClient } from "@clerk/nextjs/server";
import { jsonError, readJson } from "@/lib/api";
import { denyUnlessOrganiser, getUserId } from "@/lib/auth";
import { roleFromMetadata } from "@/lib/roles";

type Context = { params: Promise<{ id: string }> };

// Only switches people between attendant and moderator. Organisers can't be changed or created here.
export async function PATCH(request: Request, { params }: Context) {
  const denied = await denyUnlessOrganiser();
  if (denied) return denied;

  const { role } = ((await readJson(request)) ?? {}) as { role?: unknown };
  if (role !== "moderator" && role !== "attendant") return jsonError("Choose a valid role.", 400);

  const { id } = await params;
  if (id === (await getUserId())) return jsonError("You can't change your own role.", 400);

  const client = await clerkClient();
  let target;
  try {
    target = await client.users.getUser(id);
  } catch {
    return jsonError("Person not found.", 404);
  }
  if (roleFromMetadata(target.publicMetadata) === "organiser") {
    return jsonError("Organisers can't be changed here.", 403);
  }

  await client.users.updateUserMetadata(id, { publicMetadata: { role: role === "moderator" ? "moderator" : null } });
  return Response.json({ id, role });
}
