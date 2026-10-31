"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ROLE_LABELS, type Role, type TeamMember } from "@/lib/roles";

export function TeamManager({ role }: { role: Role }) {
  const [people, setPeople] = useState<TeamMember[] | null>(null);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (query: string) => {
    try {
      const response = await fetch(`/api/team?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error();
      setPeople(await response.json());
      setError("");
    } catch {
      setError("Couldn't load people. Please try again.");
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    load(search);
  }

  async function changeRole(person: TeamMember, nextRole: "moderator" | "attendant") {
    setSavingId(person.id);
    setError("");
    try {
      const response = await fetch(`/api/team/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't change that role. Please try again.");
      }
      setPeople((current) => current?.map((item) => (item.id === person.id ? { ...item, role: nextRole } : item)) ?? null);
    } catch (caught) {
      setError(caught instanceof TypeError ? "Couldn't reach the server. Please try again." : (caught as Error).message);
    } finally {
      setSavingId("");
    }
  }

  return (
    <div className="min-h-dvh pb-12">
      <AppHeader role={role} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
          <p className="mt-2 text-muted">
            Moderators can add events and handle tickets. People need to sign up before they appear here.
          </p>
          <Link href="/organiser/errors" className="inline-flex min-h-11 items-center text-[15px] text-accent underline underline-offset-2">
            View error log
          </Link>
        </div>

        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            aria-label="Search by name or email"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-control-line bg-transparent px-3 text-base placeholder:text-muted"
          />
          <button type="submit" className="min-h-11 rounded-full border border-control-line px-5 font-medium transition-colors hover:bg-accent-soft">
            Search
          </button>
        </form>

        {error && <p role="alert" className="text-[15px] text-danger">{error}</p>}
        {people?.length === 0 && <p className="text-muted">No one found.</p>}
        {people && people.length > 0 && (
          <ul className="divide-y divide-line rounded-2xl bg-surface">
            {people.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {person.name || person.email || "Unnamed"}
                    {person.isSelf && <span className="font-normal text-muted"> (you)</span>}
                  </p>
                  {person.name && <p className="text-[15px] text-muted [overflow-wrap:anywhere]">{person.email}</p>}
                  <p className="text-sm font-semibold">{ROLE_LABELS[person.role]}</p>
                </div>
                {person.role === "attendant" && (
                  <button
                    type="button"
                    disabled={savingId === person.id}
                    onClick={() => changeRole(person, "moderator")}
                    className="min-h-11 rounded-full bg-accent px-5 text-[15px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
                  >
                    Make moderator
                  </button>
                )}
                {person.role === "moderator" && (
                  <button
                    type="button"
                    disabled={savingId === person.id}
                    onClick={() => changeRole(person, "attendant")}
                    className="min-h-11 rounded-full px-5 text-[15px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
                  >
                    Remove moderator
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
