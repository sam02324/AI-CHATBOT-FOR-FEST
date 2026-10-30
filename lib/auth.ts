import { auth, currentUser } from "@clerk/nextjs/server";
import { jsonError } from "./api";
import { isStaff, roleFromMetadata, type Role } from "./roles";

// Everyone is an attendant unless their Clerk public metadata gives them another role.
// Users can't edit public metadata, so they can't change their own role.
export async function getRole(): Promise<Role | null> {
  const user = await currentUser();
  return user ? roleFromMetadata(user.publicMetadata) : null;
}

export async function getUserId() {
  const { userId } = await auth();
  return userId;
}

// These return an error response if access is denied, or null if the request may continue.
export async function denyUnlessStaff() {
  const role = await getRole();
  if (!role) return jsonError("Please sign in.", 401);
  return isStaff(role) ? null : jsonError("Only organisers and moderators can do this.", 403);
}

export async function denyUnlessOrganiser() {
  const role = await getRole();
  if (!role) return jsonError("Please sign in.", 401);
  return role === "organiser" ? null : jsonError("Only organisers can do this.", 403);
}
