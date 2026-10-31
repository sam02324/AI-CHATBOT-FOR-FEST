import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { getRole } from "@/lib/auth";
import { listRecentErrors, type LoggedError } from "@/lib/errors";

export const metadata: Metadata = { title: "Error log" };

// A fixed time zone, so the times shown don't depend on where the server runs.
const timeFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

// Raw error text can name the AI provider, which people using the app should never see.
// The server logs and the database keep the original wording.
function hideProvider(text: string) {
  return text.replace(/anthropic|claude/gi, "AI");
}

// Returns null if the log can't be read. The database being down is a likely reason to come here.
async function loadErrors(): Promise<LoggedError[] | null> {
  try {
    return await listRecentErrors();
  } catch (error) {
    console.error("Couldn't load the error log", error);
    return null;
  }
}

export default async function ErrorLogPage() {
  const role = await getRole();
  if (!role) redirect("/sign-in");
  if (role !== "organiser") redirect(role === "moderator" ? "/organiser" : "/chat");
  const errors = await loadErrors();

  return (
    <div className="min-h-dvh pb-12">
      <AppHeader role={role} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Error log</h1>
          <p className="mt-2 text-muted">
            Shows the latest 100 problems from the running app, and keeps them for 30 days. Times are in India time.
          </p>
        </div>

        {!errors && (
          <p role="alert" className="text-[15px] text-danger">
            Couldn&apos;t load the error log. The database may be down, so please try again soon.
          </p>
        )}
        {errors?.length === 0 && <p className="text-muted">Good news: no problems have been recorded.</p>}
        {errors && errors.length > 0 && (
          <ul className="divide-y divide-line rounded-2xl bg-surface">
            {errors.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4">
                  <span className="text-sm font-semibold [overflow-wrap:anywhere]">{hideProvider(item.source)}</span>
                  <span className="text-sm text-muted">{timeFormat.format(new Date(item.created_at))}</span>
                </div>
                <p className="mt-2 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap">{hideProvider(item.message)}</p>
                {item.path && <p className="mt-2 font-mono text-sm text-muted [overflow-wrap:anywhere]">{hideProvider(item.path)}</p>}
                {item.stack && (
                  <details className="mt-1">
                    <summary className="min-h-11 cursor-pointer py-2.5 text-sm leading-6 text-muted">Stack trace</summary>
                    <pre className="pb-1 text-sm text-muted [overflow-wrap:anywhere] whitespace-pre-wrap">{hideProvider(item.stack)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
