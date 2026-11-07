CREATE TABLE auth_user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  username TEXT UNIQUE,
  display_username TEXT
);

CREATE TABLE auth_session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_id ON auth_session(user_id);

CREATE TABLE auth_account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider_id, account_id)
);
CREATE INDEX auth_account_user_id ON auth_account(user_id);

CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX auth_verification_identifier ON auth_verification(identifier);

CREATE TABLE auth_owner_bootstrap (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  user_id TEXT NOT NULL UNIQUE
);

CREATE TABLE auth_recovery (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE auth_rate_limit (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
