"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TicketConversation } from "@/components/TicketConversation";
import { STATUS_LABELS, TICKET_STATUSES, type Role, type Ticket, type TicketStatus } from "@/lib/roles";

type Filter = TicketStatus | "all";

const REFRESH_MS = 8000;
const PRESENCE_MS = 20000;

function TicketCard({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  const liveNow = ticket.live && ticket.status !== "resolved";
  const [open, setOpen] = useState(liveNow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function changeStatus(status: TicketStatus) {
    setSaving(true);
    setError("");
    try {
      const result = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save. Please try again.");
      }
      onChanged();
    } catch (caught) {
      setError(caught instanceof TypeError ? "Couldn't reach the server. Please try again." : (caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className={`rounded-2xl bg-surface p-4 sm:p-5 ${liveNow ? "border-2 border-accent" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted">{ticket.id}</span>
          {liveNow && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">Live chat</span>}
        </span>
        <span className="text-sm text-muted">{new Date(ticket.created_at).toLocaleString()}</span>
      </div>
      <p className="mt-2 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap">{ticket.description}</p>
      <p className="mt-2 text-sm [overflow-wrap:anywhere]">
        From {ticket.user_name || "Unnamed attendant"}
        {ticket.user_email && (
          <>
            {" · "}
            <a href={`mailto:${ticket.user_email}`} className="text-accent underline underline-offset-2">
              {ticket.user_email}
            </a>
          </>
        )}
      </p>
      {ticket.response && <p className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">Earlier reply: {ticket.response}</p>}

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor={`status-${ticket.id}`} className="mb-1 block text-sm font-medium">Status</label>
          <select
            id={`status-${ticket.id}`}
            value={ticket.status}
            disabled={saving}
            onChange={(event) => changeStatus(event.target.value as TicketStatus)}
            className="min-h-11 rounded-lg border border-control-line bg-surface px-3 text-base"
          >
            {TICKET_STATUSES.map((option) => (
              <option key={option} value={option}>{STATUS_LABELS[option]}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-h-11 text-[15px] font-medium text-accent"
        >
          {open ? "Hide conversation" : "Open conversation"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {open && (
        <div className="mt-3 border-t border-line pt-2">
          <TicketConversation ticketId={ticket.id} viewer="staff" />
        </div>
      )}
    </li>
  );
}

export function StaffTickets({ role }: { role: Role }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tickets?scope=all");
      if (!response.ok) throw new Error();
      setTickets(await response.json());
      setError("");
    } catch {
      setError("Couldn't load tickets. Refresh the page to try again.");
    }
  }, []);

  // While this page is open and visible, this person counts as online and sees new tickets.
  useEffect(() => {
    const whenVisible = (action: () => void) => () => {
      if (document.visibilityState === "visible") action();
    };
    const checkIn = () => fetch("/api/presence", { method: "POST" }).catch(() => null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    checkIn();
    const refresh = setInterval(whenVisible(load), REFRESH_MS);
    const presence = setInterval(whenVisible(checkIn), PRESENCE_MS);
    return () => {
      clearInterval(refresh);
      clearInterval(presence);
    };
  }, [load]);

  const shown = tickets?.filter((ticket) => filter === "all" || ticket.status === filter) ?? [];
  const filters: Filter[] = ["all", ...TICKET_STATUSES];

  return (
    <div className="min-h-dvh pb-12">
      <AppHeader role={role} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Tickets</h1>
          <p className="mt-2 text-muted">
            You&apos;re shown as online while this page is open, so attendants can start a live chat with you.
          </p>
        </div>

        <div role="group" aria-label="Filter tickets" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-line p-1 sm:w-fit">
          {filters.map((option) => {
            const count = tickets?.filter((ticket) => option === "all" || ticket.status === option).length ?? 0;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
                className={`min-h-10 shrink-0 rounded-lg px-3 text-[15px] font-medium transition-colors ${
                  filter === option ? "bg-surface shadow-sm" : "text-muted"
                }`}
              >
                {option === "all" ? "All" : STATUS_LABELS[option]} ({count})
              </button>
            );
          })}
        </div>

        {error && <p role="alert" className="text-[15px] text-danger">{error}</p>}
        {tickets && shown.length === 0 && <p className="text-muted">No tickets here.</p>}
        <ul className="space-y-4">
          {shown.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onChanged={load} />
          ))}
        </ul>
      </main>
    </div>
  );
}
