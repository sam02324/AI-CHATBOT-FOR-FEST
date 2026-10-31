"use client";

import { Check, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TicketConversation } from "@/components/TicketConversation";
import {
  STATUS_LABELS,
  TICKET_STATUSES,
  type ChatMessage,
  type Role,
  type Ticket,
  type TicketPage,
  type TicketStatus,
} from "@/lib/roles";

type Filter = TicketStatus | "all";
// A page from the server, along with the filter and limit it was asked for with.
type LoadedPage = TicketPage & { filter: Filter; limit: number };

const REFRESH_MS = 8000;
const PRESENCE_MS = 20000;
const PAGE_SIZE = 30;
const secondaryButton =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-control-line px-4 text-[15px] font-medium transition-colors hover:bg-accent-soft disabled:opacity-40";

function whenVisible(action: () => void) {
  return () => {
    if (document.visibilityState === "visible") action();
  };
}

// What the attendant and the AI assistant said before this ticket was raised.
// It can't change, so it's only fetched the first time staff ask to see it.
function TicketTranscript({ ticketId, count }: { ticketId: string; count: number }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setOpen(!open);
    if (open || messages || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/tickets/${ticketId}/transcript`);
      if (!response.ok) throw new Error();
      setMessages(await response.json());
    } catch {
      // Closes again, so one more press of the button tries again.
      setOpen(false);
      setError("Couldn't load this chat. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="-ml-1 min-h-11 px-1 text-left text-[15px] font-medium text-accent"
      >
        {open ? "Hide" : "Show"} the chat before this ticket ({count} {count === 1 ? "message" : "messages"})
      </button>
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
      {open && (
        <div className="mt-1 rounded-xl border border-line bg-background p-3">
          {loading && <p role="status" className="text-sm text-muted">Loading the chat…</p>}
          {messages && (
            <ul aria-label="Chat before this ticket" tabIndex={0} className="max-h-96 space-y-3 overflow-y-auto">
              {messages.map((message, index) => (
                <li key={index}>
                  <p className="text-xs font-medium text-muted">{message.role === "user" ? "Attendant" : "AI assistant"}</p>
                  <p className="mt-0.5 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap">{message.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TicketCard({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  const liveNow = ticket.live && ticket.status !== "resolved";
  const transcriptCount = ticket.transcript_count ?? 0;
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
      {transcriptCount > 0 && <TicketTranscript ticketId={ticket.id} count={transcriptCount} />}

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
  const [page, setPage] = useState<LoadedPage | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Goes up after a ticket is changed here, which loads the list again with the current filter and limit.
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState("");

  // Loads the list now, and again regularly while this page is visible.
  useEffect(() => {
    // Set when the filter or limit changes, so responses to the earlier request are ignored.
    let outOfDate = false;
    let lastSent = 0;
    let lastUsed = 0;

    async function load() {
      const request = ++lastSent;
      try {
        const response = await fetch(`/api/tickets?scope=all&status=${filter === "all" ? "" : filter}&limit=${limit}`);
        if (!response.ok) throw new Error();
        const body: TicketPage = await response.json();
        // A slow response can't replace a newer one that has already arrived.
        if (outOfDate || request < lastUsed) return;
        lastUsed = request;
        setPage({ ...body, filter, limit });
        setError("");
      } catch {
        if (!outOfDate && request > lastUsed) setError("Couldn't load tickets. Refresh the page to try again.");
      }
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const refresh = setInterval(whenVisible(load), REFRESH_MS);
    return () => {
      outOfDate = true;
      clearInterval(refresh);
    };
  }, [filter, limit, reloads]);

  // While this page is open and visible, this person counts as online.
  // It's separate from loading the list, so changing the filter or limit doesn't check in again.
  useEffect(() => {
    const checkIn = () => fetch("/api/presence", { method: "POST" }).catch(() => null);
    checkIn();
    const presence = setInterval(whenVisible(checkIn), PRESENCE_MS);
    return () => clearInterval(presence);
  }, []);

  function chooseFilter(option: Filter) {
    if (option === filter) return;
    setFilter(option);
    setLimit(PAGE_SIZE);
  }

  function countFor(option: Filter) {
    if (option !== "all") return page?.counts[option] ?? 0;
    return TICKET_STATUSES.reduce((total, status) => total + (page?.counts[status] ?? 0), 0);
  }

  // Tickets already loaded that fit the filter show straight away, while the new data loads.
  const shown = page?.tickets.filter((ticket) => filter === "all" || ticket.status === filter).slice(0, limit) ?? [];
  const filterLoaded = page?.filter === filter;
  const loadingMore = filterLoaded && page.limit !== limit && !error;
  // The server stops at its own maximum, so there's only more to load if it sent as many as were asked for.
  const canLoadMore = filterLoaded && page.tickets.length === page.limit && page.tickets.length < countFor(filter);
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
          {filters.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => chooseFilter(option)}
              className={`min-h-11 shrink-0 rounded-lg px-3 text-[15px] font-medium transition-colors ${
                filter === option ? "bg-surface shadow-sm" : "text-muted"
              }`}
            >
              {option === "all" ? "All" : STATUS_LABELS[option]} ({countFor(option)})
            </button>
          ))}
        </div>

        {error && <p role="alert" className="text-[15px] text-danger">{error}</p>}
        {filterLoaded && shown.length === 0 && <p className="text-muted">No tickets here.</p>}
        {!filterLoaded && shown.length === 0 && !error && <p role="status" className="text-muted">Loading tickets…</p>}
        <ul className="space-y-4">
          {shown.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onChanged={() => setReloads((count) => count + 1)} />
          ))}
        </ul>
        {canLoadMore && (
          <div className="flex justify-center">
            <button type="button" disabled={loadingMore} onClick={() => setLimit(limit + PAGE_SIZE)} className={secondaryButton}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
