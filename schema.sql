-- Run this in your Neon SQL editor
-- Neon dashboard → SQL Editor → paste and run

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  games_played INTEGER     DEFAULT 0,
  best_score   INTEGER     DEFAULT 0,
  total_score  BIGINT      DEFAULT 0,
  scores       JSONB       DEFAULT '[]',
  streak       INTEGER     DEFAULT 0,
  last_played  DATE,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
