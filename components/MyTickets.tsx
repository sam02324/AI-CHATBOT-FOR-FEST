"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TicketConversation } from "@/components/TicketConversation";
import { STATUS_LABELS, type Role, type Ticket } from "@/lib/roles";

export function MyTickets({ role }: { role: Role }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tickets");
      if (!response.ok) throw new Error();
      setTickets(await response.json());
      setLoadError("");
    } catch {
      setLoadError("Couldn't load your tickets. Refresh the page to try again.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-dvh pb-12">
      <AppHeader role={role} />
      <main className="mx-auto max-w-2xl space-y-6 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My tickets</h1>
          <p className="mt-2 text-muted">
            Need help from a person? Tap Talk to a person in the{" "}
            <Link href="/chat" className="font-medium text-accent underline underline-offset-2">chat</Link>.
          </p>
        </div>

        {loadError && <p role="alert" className="text-[15px] text-danger">{loadError}</p>}
        {tickets?.length === 0 && <p className="text-muted">You haven&apos;t raised any tickets yet.</p>}
        {tickets && tickets.length > 0 && (
          <ul className="space-y-3">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="rounded-2xl bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm text-muted">{ticket.id}</span>
                  <span className="text-sm font-semibold">{STATUS_LABELS[ticket.status]}</span>
                </div>
                <p className="mt-2 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap">{ticket.description}</p>
                {ticket.response && (
                  <div className="mt-3 rounded-xl bg-accent-soft p-3">
                    <p className="text-sm font-semibold">Reply from the fest team</p>
                    <p className="mt-1 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap">{ticket.response}</p>
                  </div>
                )}
                <button
                  type="button"
                  aria-expanded={openId === ticket.id}
                  onClick={() => setOpenId(openId === ticket.id ? null : ticket.id)}
                  className="mt-2 -ml-1 min-h-11 px-1 text-[15px] font-medium text-accent"
                >
                  {openId === ticket.id ? "Hide conversation" : "Open conversation"}
                </button>
                {openId === ticket.id && <TicketConversation ticketId={ticket.id} viewer="attendant" />}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
