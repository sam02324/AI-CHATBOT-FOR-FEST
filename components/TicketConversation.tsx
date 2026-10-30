"use client";

import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { STATUS_LABELS, type TicketThread } from "@/lib/roles";

const POLL_MS = 4000;

// The messages between an attendant and the fest team on one ticket. Staff see the same thread.
export function TicketConversation({ ticketId, viewer }: { ticketId: string; viewer: "attendant" | "staff" }) {
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const messageCount = thread?.messages.length ?? 0;

  const load = useCallback(async () => {
    const response = await fetch(`/api/tickets/${ticketId}/messages`).catch(() => null);
    if (response?.ok) setThread(await response.json());
  }, [ticketId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messageCount]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't send that. Please try again.");
      }
      setDraft("");
      await load();
    } catch (caught) {
      setError(caught instanceof TypeError ? "Couldn't reach the server. Please try again." : (caught as Error).message);
    } finally {
      setSending(false);
    }
  }

  const closed = viewer === "attendant" && thread?.status === "resolved";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={list} aria-live="polite" className="max-h-96 min-h-16 flex-1 space-y-3 overflow-y-auto py-2">
        {thread?.messages.length === 0 && (
          <p className="text-sm text-muted">
            {viewer === "attendant" ? "No replies yet. Add anything else that would help." : "No messages yet."}
          </p>
        )}
        {thread?.messages.map((message) => {
          const mine = message.sender_role === viewer;
          const label = message.sender_role === "staff" ? "Fest team" : message.sender_name || "Attendant";
          return (
            <div key={message.id} className={mine ? "ml-auto w-fit max-w-[85%]" : "w-fit max-w-[85%]"}>
              {!mine && <p className="mb-0.5 text-xs font-medium text-muted">{label}</p>}
              <p
                className={`rounded-2xl px-3 py-2 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap ${
                  mine ? "rounded-br-md bg-accent text-on-accent" : "rounded-bl-md bg-line"
                }`}
              >
                {message.content}
              </p>
            </div>
          );
        })}
      </div>

      {error && <p role="alert" className="pb-2 text-sm text-danger">{error}</p>}
      {closed ? (
        <p className="pt-2 text-sm text-muted">This ticket is {STATUS_LABELS.resolved.toLowerCase()}. Tap Talk to a person if you need more help.</p>
      ) : (
        <form onSubmit={send} className="flex items-center gap-2 pt-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={viewer === "staff" ? "Reply to the attendant" : "Write a message"}
            aria-label={viewer === "staff" ? "Reply to the attendant" : "Write a message"}
            maxLength={2000}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-full border border-control-line bg-transparent px-4 text-base placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label="Send message"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <ArrowUp aria-hidden className="size-5" />
          </button>
        </form>
      )}
    </div>
  );
}
