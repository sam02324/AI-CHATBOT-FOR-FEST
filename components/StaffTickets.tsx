"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { STATUS_LABELS, TICKET_STATUSES, type Role, type Ticket, type TicketStatus } from "@/lib/roles";

type Filter = TicketStatus | "all";

function TicketCard({ ticket, onSaved }: { ticket: Ticket; onSaved: () => void }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [response, setResponse] = useState(ticket.response);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function save() {
    setSaving(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, response }),
      });
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save. Please try again.");
      }
      setMessage("Saved. The attendant can see this now.");
      onSaved();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof TypeError ? "Couldn't reach the server. Please try again." : (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-2xl bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm text-muted">{ticket.id}</span>
        <span className="text-sm text-muted">{new Date(ticket.created_at).toLocaleString()}</span>
      </div>
      <p className="mt-2 font-medium [overflow-wrap:anywhere]">{ticket.subject}</p>
      <p className="mt-1 text-[15px] text-muted [overflow-wrap:anywhere] whitespace-pre-wrap">{ticket.description}</p>
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

      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <div>
          <label htmlFor={`status-${ticket.id}`} className="mb-1 block text-sm font-medium">Status</label>
          <select
            id={`status-${ticket.id}`}
            value={status}
            onChange={(event) => setStatus(event.target.value as TicketStatus)}
            className="min-h-11 w-full rounded-lg border border-control-line bg-surface px-3 text-base"
          >
            {TICKET_STATUSES.map((option) => (
              <option key={option} value={option}>{STATUS_LABELS[option]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`response-${ticket.id}`} className="mb-1 block text-sm font-medium">Reply to attendant</label>
          <textarea
            id={`response-${ticket.id}`}
            rows={2}
            maxLength={2000}
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            className="min-h-11 w-full resize-y rounded-lg border border-control-line bg-transparent px-3 py-2 text-base"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="min-h-11 rounded-full bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && (
          <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-danger" : "text-muted"}`}>{message}</p>
        )}
      </div>
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const shown = tickets?.filter((ticket) => filter === "all" || ticket.status === filter) ?? [];
  const filters: Filter[] = ["all", ...TICKET_STATUSES];

  return (
    <div className="min-h-dvh pb-12">
      <AppHeader role={role} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Tickets</h1>
          <p className="mt-2 text-muted">Reply to attendants and update each ticket as you work on it.</p>
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
            <TicketCard key={`${ticket.id}-${ticket.updated_at}`} ticket={ticket} onSaved={load} />
          ))}
        </ul>
      </main>
    </div>
  );
}
