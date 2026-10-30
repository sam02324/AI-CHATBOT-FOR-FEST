"use client";

import { UserButton } from "@clerk/nextjs";
import { ArrowUp, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Message = { role: "user" | "assistant"; content: string };

const MAX_HISTORY = 20;
const SUGGESTIONS = ["What events are happening?", "How do I register?", "Which events have prizes?"];

export function Chat({ canManageEvents }: { canManageEvents: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy, error]);

  async function requestAnswer(history: Message[]) {
    setBusy(true);
    setError("");
    let answer = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Keep the conversation short, always starting on a student's message.
        body: JSON.stringify({ messages: history.slice(-(MAX_HISTORY - 1)) }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong. Please try again.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += value;
        setMessages([...history, { role: "assistant", content: answer }]);
      }
      if (!answer) throw new Error("No answer came back. Please try again.");
    } catch (caught) {
      setMessages(history);
      setError(caught instanceof TypeError ? "Couldn't reach the server. Please try again." : (caught as Error).message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setDraft("");
    const history: Message[] = [...messages, { role: "user", content: question }];
    setMessages(history);
    requestAnswer(history);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(draft);
  }

  const waiting = busy && messages.at(-1)?.role === "user";

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-line bg-surface px-4 py-3">
        <div className="mx-auto flex min-h-11 max-w-2xl items-center justify-between gap-4">
          <h1 className="text-[17px] font-semibold">Fest Help</h1>
          <div className="flex items-center gap-4">
            {canManageEvents && (
              <Link href="/organiser" className="flex min-h-11 items-center text-[15px] font-medium text-accent underline-offset-4 hover:underline">
                Manage events
              </Link>
            )}
            <UserButton />
          </div>
        </div>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col">
          {messages.length === 0 && !error ? (
            <div className="my-auto py-8">
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                What do you want to know about the fest?
              </h2>
              <p className="mt-3 text-muted">Ask about events, timings, venues and registration.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="min-h-11 rounded-full border border-line bg-surface px-4 text-[15px] transition-colors hover:bg-accent-soft"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4" aria-live="polite" aria-busy={busy}>
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <p
                    key={index}
                    className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-on-accent [overflow-wrap:anywhere] whitespace-pre-wrap"
                  >
                    {message.content}
                  </p>
                ) : (
                  <p key={index} className="max-w-[92%] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {message.content}
                  </p>
                ),
              )}
              {waiting && (
                <div className="flex h-6 items-center gap-1" role="status" aria-label="Finding an answer">
                  <span className="typing-dot size-2 rounded-full bg-muted" />
                  <span className="typing-dot size-2 rounded-full bg-muted [animation-delay:0.15s]" />
                  <span className="typing-dot size-2 rounded-full bg-muted [animation-delay:0.3s]" />
                </div>
              )}
              {error && (
                <div role="alert" className="rounded-xl bg-danger-soft p-3 text-danger">
                  <p>{error}</p>
                  {messages.at(-1)?.role === "user" && (
                    <button
                      type="button"
                      onClick={() => requestAnswer(messages)}
                      className="mt-1 -ml-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 font-medium"
                    >
                      <RotateCcw aria-hidden className="size-4" />
                      Try again
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form onSubmit={submit} className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask a question"
            aria-label="Your question"
            maxLength={2000}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-full border border-control-line bg-transparent px-4 text-base placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send question"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <ArrowUp aria-hidden className="size-5" />
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-2xl text-[13px] leading-snug text-muted">
          AI assistant for fest events.
        </p>
      </footer>
    </div>
  );
}
