import { redirect } from "next/navigation";
import { Chat } from "@/components/Chat";
import { getRole } from "@/lib/auth";

export default async function ChatPage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  return <Chat canManageEvents={role === "organiser"} />;
}
