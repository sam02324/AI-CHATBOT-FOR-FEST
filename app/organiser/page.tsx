import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrganiserApp } from "@/components/OrganiserApp";
import { getRole } from "@/lib/auth";
import { isStaff } from "@/lib/roles";

export const metadata: Metadata = { title: "Events" };

export default async function OrganiserPage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  if (!isStaff(role)) redirect("/chat");
  return <OrganiserApp role={role} />;
}
