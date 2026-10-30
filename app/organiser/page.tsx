import type { Metadata } from "next";
import { OrganiserApp } from "@/components/OrganiserApp";

export const metadata: Metadata = { title: "Fest Organiser" };

// Read the PIN setting on each request, not at build time.
export const dynamic = "force-dynamic";

export default function OrganiserPage() {
  return <OrganiserApp pinRequired={Boolean(process.env.ORGANISER_PIN)} />;
}
