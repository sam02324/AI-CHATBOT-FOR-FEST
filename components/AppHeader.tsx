"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isStaff, type Role } from "@/lib/roles";

function linksFor(role: Role) {
  if (!isStaff(role)) {
    return [
      { href: "/chat", label: "Chat" },
      { href: "/tickets", label: "My tickets" },
    ];
  }
  const links = [
    { href: "/organiser", label: "Events" },
    { href: "/organiser/tickets", label: "Tickets" },
    { href: "/chat", label: "Chat" },
  ];
  return role === "organiser" ? [...links, { href: "/organiser/team", label: "Team" }] : links;
}

export function AppHeader({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-surface px-4">
      <div className="mx-auto flex min-h-14 max-w-5xl items-center gap-4">
        <span className="hidden shrink-0 text-[17px] font-semibold sm:block">Fest Help</span>
        <nav aria-label="Main" className="-ml-3 flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] sm:ml-0">
          {linksFor(role).map((link) => {
            const current = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center rounded-lg px-3 text-[15px] font-medium transition-colors ${
                  current ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0">
          <UserButton />
        </div>
      </div>
    </header>
  );
}
