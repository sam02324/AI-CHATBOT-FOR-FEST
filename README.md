# Fest Help

MVP for the Alliance One E-Cell x Dedal.in Product Development Challenge: an AI chatbot that answers attendants' questions about fest events.

- **Attendants (`/chat`):** sign in and ask about events, timings, venues and registration.
- **Organisers (`/organiser`):** sign in and add events by typing them in, or upload a poster for Claude to read. Organisers check the details before saving. They can also use the chat.

The chatbot answers only from saved events, so it says when it doesn't know something.

## Run it

Requires Node.js 20 or later.

1. Run `npm install`.
2. Create an application in the [Clerk dashboard](https://dashboard.clerk.com).
3. Copy `.env.example` to `.env.local`, then add your Anthropic API key and your Clerk keys.
4. Run `npm run dev` and open http://localhost:3000.

## Make someone an organiser

Everyone who signs up is an attendant. To make someone an organiser:

1. In the Clerk dashboard, open **Users** and select the person.
2. Under **User metadata**, edit **Public** and enter `{"role": "organiser"}`.
3. Save. The change applies on their next page load.

## Built with

Next.js, React, TypeScript, Tailwind CSS, Turso (SQLite), Vercel for hosting, Lucide icons, Clerk for login and the Claude API (`claude-opus-5-5`).

Clerk stores the names and email addresses of people who sign up.

## Disclosure

Built with AI assistance from Claude Code. Design guidance came from the open-source UI/UX Pro Max and Apple Design skills.
