# Fest Help

MVP for the Alliance One E-Cell x Dedal.in Product Development Challenge: an AI chatbot that answers attendants' questions about fest events.

- **Attendants (`/chat`):** sign in and ask about events, timings, venues and registration. Answers about specific events can include event cards with a registration link.
- **Organisers (`/organiser`):** sign in and add events by typing them in, or upload up to 5 posters for Claude to read together. Organisers check the details before saving. They can also use the chat.
- **Moderators:** an organiser can give someone this role on the Team page (`/organiser/team`). Moderators can manage events and tickets, but not the team.
- **Talking to a person:** from the chat, an attendant can reach the fest team, or the chatbot offers this when a person is needed. If a moderator or organiser has `/organiser/tickets` open, it starts a live chat. Otherwise it raises a ticket with a unique ID, and replies appear in the same conversation and under `/tickets`. The attendant can choose to attach the chat so they don't have to repeat themselves.
- **Chat history:** each person's chats are saved to their account, and they can reopen or delete them.

The chatbot answers only from saved events, so it says when it doesn't know something. It also screens out questions unrelated to the fest.

## Run it

Requires Node.js 24.

1. Run `npm install`.
2. Create an application in the [Clerk dashboard](https://dashboard.clerk.com).
3. Copy `.env.example` to `.env.local`, then add your Anthropic API key, your Clerk keys and a Postgres connection string from Neon or Supabase.
4. Run `npm run db:migrate` to create the database tables.
5. Run `npm run dev` and open http://localhost:3000.

## Roles

Everyone who signs up is an attendant. To make someone an organiser:

1. In the Clerk dashboard, open **Users** and select the person.
2. Under **User metadata**, edit **Public** and enter `{"role": "organiser"}`.
3. Save.

Organisers can make someone a moderator on the Team page.

### Keep roles in the login token

This is optional, but it removes most calls to Clerk's servers. Without it, the app still works and asks Clerk for each person's role.

1. In the Clerk dashboard, open **Sessions** and find **Customize session token**.
2. Enter this and save:

   ```json
   { "metadata": "{{user.public_metadata}}" }
   ```

Login tokens refresh about once a minute, so with this on, a role change can take up to a minute to apply.

## Database changes

Tables are defined by the numbered files in `db/migrations`, and each file runs once. On Vercel, `vercel.json` runs them before each build. If one fails, the build fails and the current version stays live. Keep them additive, because the old version keeps serving traffic until the build finishes.

To add a change, create the next numbered file. To apply it to the database in `.env.local`, run `npm run db:migrate`.

## Limits

Each person has limits on chat messages, poster reading, new tickets and ticket messages, set in `lib/rate-limit.ts`. The whole app also stops AI requests at 2,000 a day, which protects your credits if someone creates many accounts. Change that number with the optional `AI_DAILY_LIMIT` environment variable.

## Errors

Problems from the running app are recorded in your own database for 30 days. Organisers can read them from the Team page, under **View error log**. They're also in Vercel's logs.

## Tests

`npm test` runs against a temporary in-memory database, so it never touches your real data. `npm run typecheck` checks the types. GitHub runs both, plus a production build, on every push.

## Built with

Next.js, React, TypeScript, Tailwind CSS, Postgres (Neon or Supabase), Vercel for hosting, Lucide icons, Clerk for login and the Claude API (`claude-sonnet-5-5`).

Clerk stores the names and email addresses of people who sign up. The app's database stores chat history, and tickets with the name and email of the person who raised them, plus a copy of their chat if they choose to attach it.

## Disclosure

Built with AI assistance from Claude Code. Design guidance came from the open-source UI/UX Pro Max and Apple Design skills.
