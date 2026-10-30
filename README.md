# Fest Help

MVP for the Alliance One E-Cell x Dedal.in Product Development Challenge: an AI chatbot that answers students' questions about fest events.

- **Student chat (`/`):** ask about events, timings, venues and registration.
- **Organiser page (`/organiser`):** add events by typing them in, or upload a poster for Claude to read. Organisers check the details before saving.

The chatbot answers only from saved events, so it says when it doesn't know something.

## Run it

Requires Node.js 24.

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`, then add your Anthropic API key and choose an organiser PIN.
3. Run `npm run dev` and open http://localhost:3000.

## Built with

Next.js, React, TypeScript, Tailwind CSS, SQLite (built into Node.js), Lucide icons and the Claude API (`claude-opus-5-5`).

## Disclosure

Built with AI assistance from Claude Code. Design guidance came from the open-source UI/UX Pro Max and Apple Design skills.
