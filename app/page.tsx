import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth";

// Sends people to the right page for their role after they sign in.
export default async function HomePage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  redirect(role === "organiser" ? "/organiser" : "/chat");
}
