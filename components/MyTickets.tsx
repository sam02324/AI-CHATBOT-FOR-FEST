"use client";

import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { STATUS_LABELS, type Role, type Ticket } from "@/lib/roles";

const inputClass = "min-h-11 w-full rounded-lg border border-control-line bg-transparent px-3 py-2 text-base placeholder:text-muted";

export function MyTickets({ role }: { role: Role }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [raised, setRaised] = useState("");
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setRaised("");
    if (!subject.trim() || !description.trim()) {
      setError("Enter a subject and describe the issue.");
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Something went wrong. Please try again.");
        return;
      }
      setSubject("");
      setDescription("");
      setRaised(`Your ticket is raised. Your ticket ID is ${body.id}.`);
      load();
    } catch {
      setError("Couldn't reach the server. Your message is still here, so please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-dvh pb-12">
      <AppHeader role={role} />
      <main className="mx-auto max-w-2xl space-y-6 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Raise a ticket</h1>
          <p className="mt-2 text-muted">Need help from a person? The fest team will see this and reply here.</p>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-surface p-4 sm:p-5">
          <div>
            <label htmlFor="subject" className="mb-1 block text-sm font-medium">Subject</label>
            <input id="subject" value={subject} maxLength={120} onChange={(event) => setSubject(event.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="description" className="mb-1 block text-sm font-medium">What do you need help with?</label>
            <textarea
              id="description"
              rows={4}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              className={`${inputClass} resize-y`}
            />
          </div>
          <p className="text-sm text-muted">Your name and email are shared with the fest team so they can help you.</p>
          {error && (
            <p role="alert" className="flex items-start gap-2 text-[15px] text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={sending}
            className="min-h-11 rounded-full bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {sending ? "Raising ticket…" : "Raise ticket"}
          </button>
        </form>

        {raised && <p role="status" className="rounded-xl bg-accent-soft p-3 text-[15px]">{raised}</p>}

        <section aria-labelledby="my-tickets" className="pt-2">
          <h2 id="my-tickets" className="text-xl font-semibold tracking-tight">Your tickets</h2>
          {loadError && <p role="alert" className="mt-3 text-[15px] text-danger">{loadError}</p>}
          {tickets?.length === 0 && <p className="mt-3 text-muted">You haven&apos;t raised any tickets yet.</p>}
          {tickets && tickets.length > 0 && (
            <ul className="mt-3 space-y-3">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="rounded-2xl bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm text-muted">{ticket.id}</span>
                    <span className="text-sm font-semibold">{STATUS_LABELS[ticket.status]}</span>
                  </div>
                  <p className="mt-2 font-medium [overflow-wrap:anywhere]">{ticket.subject}</p>
                  <p className="mt-1 text-[15px] text-muted [overflow-wrap:anywhere] whitespace-pre-wrap">{ticket.description}</p>
                  {ticket.response && (
                    <div className="mt-3 rounded-xl bg-accent-soft p-3">
                      <p className="text-sm font-semibold">Reply from the fest team</p>
                      <p className="mt-1 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap">{ticket.response}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
