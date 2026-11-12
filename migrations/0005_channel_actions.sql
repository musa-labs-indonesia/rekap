CREATE TABLE channel_pending_edits (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id),
  external_chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(integration_id, external_chat_id, user_id)
);

CREATE INDEX channel_pending_edits_expiry ON channel_pending_edits(expires_at);
