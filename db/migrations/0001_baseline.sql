-- The schema as it stood before migrations existed. Every statement is safe to run
-- on a database that already has these tables.

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  organiser TEXT NOT NULL DEFAULT '',
  coordinator_contact TEXT NOT NULL DEFAULT '',
  registration_link TEXT NOT NULL DEFAULT '',
  fee TEXT NOT NULL DEFAULT '',
  eligibility TEXT NOT NULL DEFAULT '',
  team_size TEXT NOT NULL DEFAULT '',
  prizes TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS custom_sections TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_conversation ON chat_messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  response TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_user ON tickets (user_id, created_at DESC);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS live BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages (ticket_id, id);

CREATE TABLE IF NOT EXISTS staff_presence (
  user_id TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
