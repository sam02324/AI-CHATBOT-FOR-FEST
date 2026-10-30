import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrganiserApp } from "@/components/OrganiserApp";
import { getRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Fest Organiser" };

export default async function OrganiserPage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  if (role !== "organiser") redirect("/chat");
  return <OrganiserApp />;
}
