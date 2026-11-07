CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chat_id TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(profile_id, name_key)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  item TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  telegram_chat_id TEXT,
  telegram_message_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(telegram_chat_id, telegram_message_id)
);

CREATE INDEX expenses_profile_date ON expenses(profile_id, occurred_at DESC);

CREATE TRIGGER expense_total_limit_insert BEFORE INSERT ON expenses
WHEN NEW.amount > 9000000000000000 - COALESCE((SELECT SUM(amount) FROM expenses WHERE profile_id = NEW.profile_id), 0)
BEGIN
  SELECT RAISE(ABORT, 'spending limit exceeded');
END;

CREATE TRIGGER expense_total_limit_update BEFORE UPDATE OF amount, profile_id ON expenses
WHEN NEW.amount > 9000000000000000 - COALESCE((SELECT SUM(amount) FROM expenses WHERE profile_id = NEW.profile_id AND id != OLD.id), 0)
BEGIN
  SELECT RAISE(ABORT, 'spending limit exceeded');
END;

CREATE TABLE telegram_recorded_messages (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

CREATE TRIGGER record_telegram_message AFTER INSERT ON expenses
WHEN NEW.telegram_chat_id IS NOT NULL AND NEW.telegram_message_id IS NOT NULL
BEGIN
  INSERT INTO telegram_recorded_messages (chat_id, message_id)
  VALUES (NEW.telegram_chat_id, NEW.telegram_message_id);
END;
