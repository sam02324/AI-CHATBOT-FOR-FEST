-- Counts requests per person and time window, shared across serverless instances.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window ON rate_limits (window_start);

-- Errors from the running app, shown to organisers.
CREATE TABLE IF NOT EXISTS error_log (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT NOT NULL DEFAULT '',
  digest TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS error_log_created ON error_log (created_at DESC);

-- A copy of the chat a ticket came from, so people don't have to repeat themselves.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transcript TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transcript_count INTEGER NOT NULL DEFAULT 0;

-- Supports filtering and counting tickets by status.
CREATE INDEX IF NOT EXISTS tickets_status_created ON tickets (status, created_at DESC);
