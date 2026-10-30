# Fest Help

MVP for the Alliance One E-Cell x Dedal.in Product Development Challenge: an AI chatbot that answers attendants' questions about fest events.

- **Attendants (`/chat`):** sign in and ask about events, timings, venues and registration.
- **Organisers (`/organiser`):** sign in and add events by typing them in, or upload up to 5 posters for Claude to read together. Organisers check the details before saving. They can also use the chat.

- **Moderators:** an organiser can give someone this role on the Team page (`/organiser/team`). Moderators can manage events and tickets, but not the team.
- **Tickets:** anyone signed in can raise a ticket at `/tickets` and gets a unique ID. Organisers and moderators reply at `/organiser/tickets`.
- **Chat history:** each person's chats are saved to their account, and they can reopen or delete them.

The chatbot answers only from saved events, so it says when it doesn't know something. It also screens out questions unrelated to the fest.

## Run it

Requires Node.js 20 or later.

1. Run `npm install`.
2. Create an application in the [Clerk dashboard](https://dashboard.clerk.com).
3. Copy `.env.example` to `.env.local`, then add your Anthropic API key, your Clerk keys and a Postgres connection string from Neon or Supabase.
4. Run `npm run dev` and open http://localhost:3000.

## Make someone an organiser

Everyone who signs up is an attendant. To make someone an organiser:

1. In the Clerk dashboard, open **Users** and select the person.
2. Under **User metadata**, edit **Public** and enter `{"role": "organiser"}`.
3. Save. The change applies on their next page load.

## Built with

Next.js, React, TypeScript, Tailwind CSS, Postgres (Neon or Supabase), Vercel for hosting, Lucide icons, Clerk for login and the Claude API (`claude-sonnet-5-5`).

Clerk stores the names and email addresses of people who sign up. The app's database stores chat history, and tickets with the name and email of the person who raised them.

## Disclosure

Built with AI assistance from Claude Code. Design guidance came from the open-source UI/UX Pro Max and Apple Design skills.
