import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffTickets } from "@/components/StaffTickets";
import { getRole } from "@/lib/auth";
import { isStaff } from "@/lib/roles";

export const metadata: Metadata = { title: "Tickets" };

export default async function StaffTicketsPage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  if (!isStaff(role)) redirect("/chat");
  return <StaffTickets role={role} />;
}
