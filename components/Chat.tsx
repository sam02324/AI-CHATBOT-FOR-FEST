"use client";

import { ArrowLeft, ArrowUp, History, LifeBuoy, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TicketConversation } from "@/components/TicketConversation";
import type { ChatMessage, ConversationSummary, Role, Ticket } from "@/lib/roles";

const SUGGESTIONS = ["What events are happening?", "How do I register?", "Which events have prizes?"];

export function Chat({ role }: { role: Role }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedQuestion, setFailedQuestion] = useState("");
  // The "reach a person" step: null when closed, otherwise whether staff are online.
  const [handoff, setHandoff] = useState<{ online: boolean | null } | null>(null);
  const [handoffText, setHandoffText] = useState("");
  const [handoffError, setHandoffError] = useState("");
  const [raising, setRaising] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations").catch(() => null);
    if (response?.ok) setConversations(await response.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy, error, handoff]);

  async function openHandoff(text: string) {
    setHandoffText(text);
    setHandoffError("");
    setHandoff({ online: null });
    const response = await fetch("/api/presence").catch(() => null);
    const body = response?.ok ? await response.json() : { online: false };
    setHandoff({ online: body.online });
  }

  async function raiseTicket(event: FormEvent) {
    event.preventDefault();
    if (!handoffText.trim()) {
      setHandoffError("Tell us what you need help with.");
      return;
    }
    setRaising(true);
    setHandoffError("");
    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: handoffText }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
      setTicket(body);
      setHandoff(null);
    } catch (caught) {
      setHandoffError(caught instanceof TypeError ? "Couldn't reach the server. Please try again." : (caught as Error).message);
    } finally {
      setRaising(false);
    }
  }

  async function requestAnswer(question: string, shown: ChatMessage[]) {
    setBusy(true);
    setError("");
    setFailedQuestion("");
    let answer = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: question }),
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
        setMessages([...shown, { role: "assistant", content: answer }]);
      }
      if (!answer) throw new Error("No answer came back. Please try again.");
      setConversationId(response.headers.get("X-Conversation-Id"));
      loadConversations();
      if (response.headers.get("X-Chat-Action") === "handoff") openHandoff(question);
    } catch (caught) {
      setMessages(shown);
      setFailedQuestion(question);
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
    const shown: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(shown);
    requestAnswer(question, shown);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(draft);
  }

  function startNewChat() {
    setMessages([]);
    setConversationId(null);
    setError("");
    setFailedQuestion("");
    setHistoryOpen(false);
    setHandoff(null);
    input.current?.focus();
  }

  async function openConversation(id: string) {
    setError("");
    setFailedQuestion("");
    setHistoryOpen(false);
    setHandoff(null);
    setTicket(null);
    try {
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) throw new Error();
      setMessages(await response.json());
      setConversationId(id);
    } catch {
      setError("Couldn't open that chat. Please try again.");
    }
  }

  async function removeConversation(item: ConversationSummary) {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    const response = await fetch(`/api/conversations/${item.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      setError("Couldn't delete that chat. Please try again.");
      return;
    }
    if (item.id === conversationId) startNewChat();
    loadConversations();
  }

  const waiting = busy && messages.at(-1)?.role === "user";

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader role={role} />

      <div className="relative flex min-h-0 flex-1">
        <aside
          aria-label="Chat history"
          className={`${historyOpen ? "flex" : "hidden"} absolute inset-0 z-10 flex-col bg-surface lg:static lg:flex lg:w-72 lg:shrink-0 lg:border-r lg:border-line`}
        >
          <div className="flex items-center gap-2 p-3">
            <button
              type="button"
              onClick={startNewChat}
              disabled={busy}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-control-line px-4 text-[15px] font-medium transition-colors hover:bg-accent-soft disabled:opacity-40"
            >
              <Plus aria-hidden className="size-4" />
              New chat
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              aria-label="Close chat history"
              className="flex size-11 items-center justify-center rounded-full lg:hidden"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {conversations.length === 0 ? (
              <p className="px-2 text-sm text-muted">Your past chats will appear here.</p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((item) => (
                  <li key={item.id} className={`flex items-center rounded-lg ${item.id === conversationId ? "bg-accent-soft" : ""}`}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openConversation(item.id)}
                      aria-current={item.id === conversationId ? "true" : undefined}
                      className="min-h-11 min-w-0 flex-1 truncate rounded-lg px-3 text-left text-[15px] transition-colors hover:text-accent disabled:opacity-40"
                    >
                      {item.title}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeConversation(item)}
                      aria-label={`Delete chat: ${item.title}`}
                      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {ticket ? (
          <div className="flex min-w-0 flex-1 flex-col p-4">
            <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
              <button
                type="button"
                onClick={() => setTicket(null)}
                className="-ml-1 inline-flex min-h-11 w-fit items-center gap-2 px-1 text-[15px] font-medium text-muted"
              >
                <ArrowLeft aria-hidden className="size-4" />
                Back to AI chat
              </button>
              <div role="status" className="rounded-xl bg-accent-soft p-3 text-[15px]">
                <p className="font-semibold">
                  {ticket.live ? "You're connected to the fest team" : "Your ticket is raised"}
                </p>
                <p className="mt-1">
                  {ticket.live
                    ? "A moderator is online and can see your message. Replies appear here."
                    : "No moderator is online right now. They'll reply here, and you can find it later in My tickets."}
                  {" "}Your ticket ID is <span className="font-mono font-semibold">{ticket.id}</span>.
                </p>
              </div>
              <p className="mt-3 text-[15px] text-muted [overflow-wrap:anywhere]">{ticket.description}</p>
              <TicketConversation ticketId={ticket.id} viewer="attendant" />
            </div>
          </div>
        ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-line px-4 py-1 lg:hidden">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-muted"
            >
              <History aria-hidden className="size-4" />
              Chat history
            </button>
          </div>

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
                      {failedQuestion && (
                        <button
                          type="button"
                          onClick={() => requestAnswer(failedQuestion, messages)}
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
              {handoff && (
                <form onSubmit={raiseTicket} className="mt-4 space-y-3 rounded-2xl bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold" role="status">
                      {handoff.online === null
                        ? "Checking who's available…"
                        : handoff.online
                          ? "A moderator is online"
                          : "No moderator is online right now"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setHandoff(null)}
                      aria-label="Close"
                      className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full"
                    >
                      <X aria-hidden className="size-5" />
                    </button>
                  </div>
                  <div>
                    <label htmlFor="handoff-text" className="mb-1 block text-sm font-medium">What do you need help with?</label>
                    <textarea
                      id="handoff-text"
                      rows={3}
                      maxLength={2000}
                      value={handoffText}
                      onChange={(event) => setHandoffText(event.target.value)}
                      className="min-h-11 w-full resize-y rounded-lg border border-control-line bg-transparent px-3 py-2 text-base"
                    />
                  </div>
                  <p className="text-sm text-muted">Your name and email are shared with the fest team so they can help you.</p>
                  {handoffError && <p role="alert" className="text-sm text-danger">{handoffError}</p>}
                  <button
                    type="submit"
                    disabled={raising || handoff.online === null}
                    className="min-h-11 rounded-full bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
                  >
                    {raising ? "Sending…" : handoff.online ? "Connect to a moderator" : "Raise a ticket"}
                  </button>
                </form>
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
            <div className="mx-auto mt-1 flex max-w-2xl flex-wrap items-center justify-between gap-x-3">
              <p className="text-[13px] leading-snug text-muted">AI assistant for fest events. Your chats are saved to your account.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => openHandoff(draft.trim() || [...messages].reverse().find((message) => message.role === "user")?.content || "")}
                className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-accent disabled:opacity-40"
              >
                <LifeBuoy aria-hidden className="size-4" />
                Talk to a person
              </button>
            </div>
          </footer>
        </div>
        )}
      </div>
    </div>
  );
}
