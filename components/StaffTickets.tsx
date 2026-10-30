"use client";

import { Check, RotateCcw, Trash2 } from "lucide-react";
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

  async function remove() {
    if (!confirm(`Delete ticket ${ticket.id} and its messages? This can't be undone, and the attendant will no longer see it.`)) return;
    setSaving(true);
    setError("");
    try {
      const result = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't delete it. Please try again.");
      }
      onChanged();
    } catch (caught) {
      setError(caught instanceof TypeError ? "Couldn't reach the server. Please try again." : (caught as Error).message);
      setSaving(false);
    }
  }

  const secondaryButton =
    "inline-flex min-h-11 items-center gap-2 rounded-full border border-control-line px-4 text-[15px] font-medium transition-colors hover:bg-accent-soft disabled:opacity-40";

  return (
    <li className={`rounded-2xl bg-surface p-4 sm:p-5 ${liveNow ? "border-2 border-accent" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted">{ticket.id}</span>
          {liveNow && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">Live chat</span>}
          <span className="text-sm font-semibold">{STATUS_LABELS[ticket.status]}</span>
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
      {ticket.status === "resolved" && ticket.resolved_by && (
        <p className="mt-2 text-sm font-medium [overflow-wrap:anywhere]">
          Resolved by {ticket.resolved_by}
          {ticket.resolved_at && ` on ${new Date(ticket.resolved_at).toLocaleString()}`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ticket.status === "resolved" ? (
          <button type="button" disabled={saving} onClick={() => changeStatus("open")} className={secondaryButton}>
            <RotateCcw aria-hidden className="size-4" />
            Reopen
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => changeStatus("resolved")}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <Check aria-hidden className="size-4" />
            Mark as resolved
          </button>
        )}
        {ticket.status === "open" && (
          <button type="button" disabled={saving} onClick={() => changeStatus("in_progress")} className={secondaryButton}>
            Mark in progress
          </button>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={remove}
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
        >
          <Trash2 aria-hidden className="size-4" />
          Delete
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-h-11 px-2 text-[15px] font-medium text-accent sm:ml-auto"
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
