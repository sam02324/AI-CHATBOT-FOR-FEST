"use client";

import { ArrowUp, History, Plus, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import type { ChatMessage, ConversationSummary, Role } from "@/lib/roles";

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
  }, [messages, busy, error]);

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
    input.current?.focus();
  }

  async function openConversation(id: string) {
    setError("");
    setFailedQuestion("");
    setHistoryOpen(false);
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
              AI assistant for fest events. Your chats are saved to your account. Need a person?{" "}
              <Link href="/tickets" className="font-medium text-accent underline underline-offset-2">
                Raise a ticket
              </Link>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
