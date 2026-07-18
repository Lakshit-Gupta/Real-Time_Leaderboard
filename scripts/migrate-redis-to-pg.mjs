#!/usr/bin/env node
// One-shot backfill of pre-Postgres data that still lives only in Redis.
//
//   node scripts/migrate-redis-to-pg.mjs --dry-run   # report only, no writes
//   node scripts/migrate-redis-to-pg.mjs             # apply
//
// Idempotent and re-runnable: every INSERT is ON CONFLICT DO NOTHING, so running
// it twice changes nothing. Uses SCAN (never KEYS — KEYS blocks the server).
//
// Reality check: state and profiles carried 24h TTLs before this migration, so
// anything older than a day is already gone. On a fresh/local Redis this will
// migrate little or nothing — it's insurance for a deployed instance with
// <24h-old data, not a big data movement.

import pg from 'pg';
import Redis from 'ioredis';

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://brainbolt:brainbolt@localhost:5432/brainbolt',
});
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
});

/** SCAN all keys matching a pattern, cursor-based so the server never blocks. */
async function scanKeys(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

const syntheticName = (id) => `player_${id.slice(0, 8)}`;

/** Ensure a users row exists. Real usernames (from profiles) win over synthetic. */
async function ensureUser(client, userId, username) {
  await client.query(
    `INSERT INTO users (user_id, username) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
    [userId, username ?? syntheticName(userId)]
  );
}

async function main() {
  const client = await pool.connect();
  const stats = { profiles: 0, states: 0, answers: 0, synthetic: 0 };
  try {
    // 1) Identities from user:profile:{id}
    for (const key of await scanKeys('user:profile:*')) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const p = JSON.parse(raw);
      const userId = p.userId ?? key.slice('user:profile:'.length);
      if (!DRY_RUN) await ensureUser(client, userId, p.username);
      stats.profiles++;
    }

    // 2) Quiz state from user:state:{id}
    for (const key of await scanKeys('user:state:*')) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const s = JSON.parse(raw);
      const userId = s.userId ?? key.slice('user:state:'.length);
      if (!DRY_RUN) {
        // Heal an orphan (state but no profile) with a synthetic identity.
        const before = await client.query('SELECT 1 FROM users WHERE user_id = $1', [userId]);
        await ensureUser(client, userId);
        if (before.rowCount === 0) stats.synthetic++;

        await client.query(
          `INSERT INTO user_state
             (user_id, difficulty, streak, max_streak, total_score, confidence,
              last_question_id, answered_ids, recent_results, state_version,
              last_answer_at, session_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, to_timestamp($11/1000.0), $12)
           ON CONFLICT (user_id) DO NOTHING`,
          [
            userId,
            s.difficulty ?? 1,
            s.streak ?? 0,
            s.maxStreak ?? 0,
            s.totalScore ?? 0,
            s.confidence ?? 5,
            s.lastQuestionId ?? null,
            Array.isArray(s.answeredIds) ? s.answeredIds : [],
            Array.isArray(s.recentResults) ? s.recentResults : [],
            s.stateVersion ?? 0,
            s.lastAnswerAt ?? Date.now(),
            s.sessionId ?? null,
          ]
        );
      }
      stats.states++;
    }

    // 3) Answer history from answers:{id} (Redis LIST)
    for (const key of await scanKeys('answers:*')) {
      const items = await redis.lrange(key, 0, -1);
      const userId = key.slice('answers:'.length);
      if (!DRY_RUN && items.length) await ensureUser(client, userId);
      for (const raw of items) {
        const a = JSON.parse(raw);
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO answer_log
               (id, user_id, question_id, difficulty, answer, correct,
                score_delta, streak_at_answer, answered_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8, to_timestamp($9/1000.0))
             ON CONFLICT (id) DO NOTHING`,
            [a.id, a.userId ?? userId, a.questionId, a.difficulty, a.answer,
             a.correct, a.scoreDelta, a.streakAtAnswer, a.answeredAt ?? Date.now()]
          );
        }
        stats.answers++;
      }
    }
  } finally {
    client.release();
  }

  console.log(DRY_RUN ? '[dry-run] would migrate:' : 'migrated:', stats);

  // 4) Rebuild the ranking zsets from the now-authoritative Postgres data.
  if (!DRY_RUN) {
    const { rows } = await pool.query('SELECT user_id, total_score, max_streak FROM user_state');
    const multi = redis.multi();
    multi.del('leaderboard:score', 'leaderboard:streak');
    for (const r of rows) {
      multi.zadd('leaderboard:score', r.total_score, r.user_id);
      multi.zadd('leaderboard:streak', r.max_streak, r.user_id);
    }
    await multi.exec();
    console.log(`rebuilt leaderboards from ${rows.length} state row(s)`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    redis.disconnect();
  });
