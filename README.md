# Filter Kaapi

An AI help assistant for campus fests. Students ask questions in a chat and get answers from the events organisers have saved. When a person is needed, the chat connects them to a moderator or raises a ticket.

Built by Team Filter Kaapi (Rishabh Rajpurohit and Ali Hamza Ahmed) for the Alliance One E-Cell x Dedal.in Product Development Challenge.

**Live app:** https://ai-chatbot-for-fest.vercel.app (you need to create an account to use it)

## What it does

- **Attendants (`/chat`):** ask about events, timings, venues and registration. Answers can include event cards with a Register button. Chats are saved to their account, and they can reopen or delete them.
- **Organisers (`/organiser`):** add events by typing them in, or upload up to 5 posters for the AI to read together. Nothing is saved until an organiser checks the details.
- **Moderators:** manage events and tickets, but not the team. Organisers give this role on the Team page (`/organiser/team`).
- **Talking to a person:** if staff have `/organiser/tickets` open, the attendant gets a live chat. Otherwise they get a ticket with a unique ID, and replies appear in the same conversation. They can choose to attach their chat.

The assistant answers only from saved events, says when it doesn't know something, and screens out questions unrelated to the fest.

## How a chat message works

1. `app/api/chat/route.ts` checks the login and rate limits, then loads the chat history from the database.
2. `classifyMessage` in `lib/claude.ts` sorts the message into `question`, `needs_person` or `off_topic`.
3. A `question` gets an answer streamed from Claude, using the saved events as its only source. `needs_person` opens the "reach a person" step, and `off_topic` gets a fixed reply.
4. The answer can end with a marker such as `[[events: a1b2c3d4]]`. `lib/chat-format.ts` removes it and the page shows event cards instead.

## Project layout

| Path | What's there |
|---|---|
| `app/` | Pages, plus the API routes in `app/api/` |
| `components/` | React components for the pages |
| `lib/` | Server logic: AI calls, database queries, roles, rate limits, error logging |
| `db/migrations/` | Numbered SQL files that define the tables |
| `scripts/migrate.mjs` | Runs the migrations |
| `proxy.ts` | Sends signed-out visitors to the sign-in page |
| `tests/` | Tests, which run against a temporary in-memory database |

## Run it locally

You need Node.js 24, an [Anthropic API key](https://console.anthropic.com), a [Clerk](https://dashboard.clerk.com) application and a Postgres database from Neon or Supabase.

```bash
npm install
cp .env.example .env.local
```

Add your keys to `.env.local`, then run:

```bash
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

Real keys go only in `.env.local`, which git ignores. `.env.example` stays empty.

## Roles

Everyone who signs up is an attendant. To make someone an organiser:

1. In the Clerk dashboard, open **Users** and select the person.
2. Under **User metadata**, edit **Public** and enter `{"role": "organiser"}`.
3. Save.

Organisers can make someone a moderator on the Team page.

### Optional: keep roles in the login token

Without this, the app asks Clerk for each person's role. With it, most of those calls go away, but a role change can take up to a minute to apply.

In the Clerk dashboard, open **Sessions**, find **Customize session token**, then enter this and save:

```json
{ "metadata": "{{user.public_metadata}}" }
```

## Tests

```bash
npm test
npm run typecheck
```

`npm test` needs no keys or database, and it can't touch real data. GitHub runs both of these, plus a production build, on every push.

Tests marked `knownBug` describe a bug that hasn't been fixed yet. They pass while the bug exists and fail once it's fixed. Run them with `SHOW_KNOWN_BUGS=1` to see the real failures.

## Database changes

Each file in `db/migrations` runs once. On Vercel, `vercel.json` runs them before each build, and if one fails, the build fails and the current version stays live. Keep them additive, because the old version keeps serving traffic until the build finishes.

To add a change, create the next numbered file and run `npm run db:migrate`.

## Limits and errors

- **Limits:** each person has limits on chat messages, poster reading, new tickets and ticket messages, set in `lib/rate-limit.ts`. The whole app also stops AI requests at 2,000 a day. Change that with the optional `AI_DAILY_LIMIT` environment variable.
- **Errors:** problems are recorded in the database for 30 days. Organisers can read them from the Team page, under **View error log**.

## Known limitations

This is an MVP, and it hasn't been used at a real fest yet.

- It hasn't been load-tested. It runs on Vercel's free plan, and live chat checks for new messages every few seconds rather than using a real-time connection.
- Staff get no alert for a new ticket, and they count as online only while the Tickets page is open.
- The chat page shows no emergency contact, so an urgent problem could end up waiting as a ticket.
- If someone sends several tickets at the same moment, they can go slightly over the limit of 10 unresolved tickets (`tests/tickets.test.ts`).
- If the AI refuses partway through screening a message, that message goes on to the assistant instead of being marked off-topic (`tests/ai-timeouts.test.ts`).

## Privacy

Clerk stores the names and email addresses of people who sign up. The app's database stores chat history, and tickets with the name and email of the person who raised them, plus a copy of their chat if they choose to attach it.

## Built with

Next.js, React, TypeScript, Tailwind CSS, Postgres, Clerk, Vercel, Lucide icons and the Claude API (`claude-sonnet-5-5`).

## AI disclosure

Built with AI assistance from Claude Code, as the challenge allowed. Design guidance came from the open-source UI/UX Pro Max and Apple Design skills.
