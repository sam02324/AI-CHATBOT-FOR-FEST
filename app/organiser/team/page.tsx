import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TeamManager } from "@/components/TeamManager";
import { getRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  if (role !== "organiser") redirect(role === "moderator" ? "/organiser" : "/chat");
  return <TeamManager role={role} />;
}
