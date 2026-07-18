-- 002 — session_id was missed in 001.
-- It is real persisted state, not a transient request field: quiz/next/route.ts
-- assigns `user.sessionId` and saves it, and quiz/answer/route.ts reads it back
-- to log a soft session-mismatch warning.

ALTER TABLE user_state ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);
