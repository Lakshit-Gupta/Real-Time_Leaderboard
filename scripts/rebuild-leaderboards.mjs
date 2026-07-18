#!/usr/bin/env node
// Rebuilds the Redis ranking zsets from Postgres (the source of truth).
// The app already does this automatically on every Redis (re)connect; this is
// the manual/ops entry point (cron, after a restore, etc.).
//
//   npm run db:rebuild
//
// Idempotent: ZADD writes absolute scores and the zsets are replaced inside a
// MULTI, so re-running is always safe.

import pg from 'pg';
import Redis from 'ioredis';

const SCORE_ZSET = 'leaderboard:score';
const STREAK_ZSET = 'leaderboard:streak';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://brainbolt:brainbolt@localhost:5432/brainbolt',
});
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
});

async function main() {
  const { rows } = await pool.query(
    'SELECT user_id, total_score, max_streak FROM user_state'
  );

  const multi = redis.multi();
  multi.del(SCORE_ZSET, STREAK_ZSET);
  for (const r of rows) {
    multi.zadd(SCORE_ZSET, r.total_score, r.user_id);
    multi.zadd(STREAK_ZSET, r.max_streak, r.user_id);
  }
  await multi.exec();

  console.log(`rebuilt ${rows.length} member(s) into ${SCORE_ZSET} and ${STREAK_ZSET}`);
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
