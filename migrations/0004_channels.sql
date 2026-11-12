CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  config TEXT,
  public_config TEXT NOT NULL DEFAULT '{}',
  webhook_secret_hash TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO integrations (id, type, name, source, public_config, status, created_at, updated_at)
VALUES ('telegram', 'telegram', 'Telegram', 'env', '{}', 'connected', unixepoch() * 1000, unixepoch() * 1000);

CREATE TABLE profile_channels (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  integration_id TEXT NOT NULL REFERENCES integrations(id),
  external_id TEXT NOT NULL,
  external_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(integration_id, external_id)
);

CREATE INDEX profile_channels_profile ON profile_channels(profile_id);

INSERT INTO profile_channels (id, profile_id, integration_id, external_id, external_name, active, created_at)
SELECT 'pc-' || id, id, 'telegram', chat_id, 'Telegram', 1, created_at
FROM profiles
WHERE chat_id NOT LIKE 'unlinked:%';

CREATE TABLE channel_link_codes (
  code_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  integration_id TEXT NOT NULL REFERENCES integrations(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

ALTER TABLE expenses ADD COLUMN channel_id TEXT;
ALTER TABLE expenses ADD COLUMN external_message_id TEXT;
ALTER TABLE expenses ADD COLUMN source TEXT NOT NULL DEFAULT 'web';

UPDATE expenses SET source = 'telegram' WHERE telegram_chat_id IS NOT NULL;

UPDATE expenses SET channel_id = (
  SELECT pc.id
  FROM profile_channels pc
  WHERE pc.integration_id = 'telegram'
    AND pc.profile_id = expenses.profile_id
    AND pc.external_id = expenses.telegram_chat_id
  LIMIT 1
)
WHERE telegram_chat_id IS NOT NULL;

UPDATE expenses SET external_message_id = CAST(telegram_message_id AS TEXT)
WHERE telegram_message_id IS NOT NULL;

CREATE UNIQUE INDEX expenses_channel_message
ON expenses(channel_id, external_message_id)
WHERE channel_id IS NOT NULL AND external_message_id IS NOT NULL;
