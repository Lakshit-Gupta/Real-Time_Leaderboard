-- 001_init.sql — durable core.
-- Amends LLD.md §4.2: no leaderboard_* tables (the Redis zset is the ranking
-- index), no questions table (questions live in src/lib/questions.ts), and
-- DOUBLE PRECISION rather than NUMERIC (calculateScore returns unrounded
-- floats, and node-postgres hands back NUMERIC as a string).

CREATE TABLE IF NOT EXISTS users (
  user_id    UUID PRIMARY KEY,
  username   VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Identity continuity: "Ada" and "ada" are the same player.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS user_state (
  user_id          UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  difficulty       INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 10),
  streak           INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  max_streak       INTEGER NOT NULL DEFAULT 0 CHECK (max_streak >= 0),
  total_score      DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (total_score >= 0),
  confidence       INTEGER NOT NULL DEFAULT 5 CHECK (confidence BETWEEN 0 AND 10),
  last_question_id VARCHAR(50),
  answered_ids     TEXT[]    NOT NULL DEFAULT '{}',
  recent_results   BOOLEAN[] NOT NULL DEFAULT '{}',
  state_version    BIGINT    NOT NULL DEFAULT 0,
  last_answer_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serve the leaderboard (and its rebuild) without a sort.
CREATE INDEX IF NOT EXISTS idx_user_state_score  ON user_state (total_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_state_streak ON user_state (max_streak DESC);

CREATE TABLE IF NOT EXISTS answer_log (
  id               VARCHAR(50) PRIMARY KEY,  -- nanoid() from adaptive.ts
  user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id      VARCHAR(50) NOT NULL,     -- no FK: questions are static code
  difficulty       INTEGER NOT NULL,
  answer           INTEGER NOT NULL,
  correct          BOOLEAN NOT NULL,
  score_delta      DOUBLE PRECISION NOT NULL,
  streak_at_answer INTEGER NOT NULL,
  answered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_answer_log_user_time ON answer_log (user_id, answered_at DESC);

-- Durable idempotency. Written in the same transaction as the score it guards,
-- so a Redis flush can no longer let a retried answer apply twice.
CREATE TABLE IF NOT EXISTS idempotency (
  key        VARCHAR(255) PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  response   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency (created_at);
