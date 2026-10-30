import { clerkClient } from "@clerk/nextjs/server";
import { denyUnlessOrganiser, getUserId } from "@/lib/auth";
import { roleFromMetadata } from "@/lib/roles";

const PAGE_SIZE = 50;

// Lists people for the Team page, optionally searching by name or email.
export async function GET(request: Request) {
  const denied = await denyUnlessOrganiser();
  if (denied) return denied;

  const search = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100);
  const client = await clerkClient();
  const { data } = await client.users.getUserList({
    limit: PAGE_SIZE,
    orderBy: "-created_at",
    ...(search ? { query: search } : {}),
  });
  const selfId = await getUserId();
  return Response.json(
    data.map((user) => ({
      id: user.id,
      name: user.fullName || user.username || "",
      email: user.primaryEmailAddress?.emailAddress ?? "",
      role: roleFromMetadata(user.publicMetadata),
      isSelf: user.id === selfId,
    })),
  );
}
