import { auth, currentUser } from "@clerk/nextjs/server";
import { jsonError } from "./api";

export type Role = "attendant" | "organiser";

// Everyone is an attendant unless their Clerk public metadata says { "role": "organiser" }.
// Users can't edit public metadata, so they can't make themselves organisers.
export async function getRole(): Promise<Role | null> {
  const user = await currentUser();
  if (!user) return null;
  return user.publicMetadata.role === "organiser" ? "organiser" : "attendant";
}

// These return an error response if access is denied, or null if the request may continue.
export async function denyUnlessSignedIn() {
  const { userId } = await auth();
  return userId ? null : jsonError("Please sign in.", 401);
}

export async function denyUnlessOrganiser() {
  const role = await getRole();
  if (!role) return jsonError("Please sign in.", 401);
  return role === "organiser" ? null : jsonError("Only organisers can do this.", 403);
}
