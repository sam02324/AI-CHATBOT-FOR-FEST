import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MyTickets } from "@/components/MyTickets";
import { getRole } from "@/lib/auth";

export const metadata: Metadata = { title: "My tickets" };

export default async function TicketsPage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  return <MyTickets role={role} />;
}
