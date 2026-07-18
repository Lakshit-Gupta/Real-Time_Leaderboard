// ─── BrainBolt Store with Redis (+ In-Memory Fallback) ─────────────────────
// Redis-first store with graceful in-memory fallback if Redis is unavailable.
// All operations are async.

import redis from './redis';
import pool, { ALLOW_MEMORY_FALLBACK, DatabaseUnavailableError, isDbReachable, withTransaction } from './db';
import { Question } from './questions';
import type { QueryResultRow } from 'pg';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserState {
  userId: string;
  difficulty: number;       // 1–10, starts at 1
  streak: number;           // current consecutive correct, resets to 0 on wrong
  maxStreak: number;        // all-time best streak
  totalScore: number;       // cumulative score
  confidence: number;       // 0–10, starts at 5 (hysteresis control)
  lastQuestionId: string | null;
  answeredIds: Set<string>; // questions already seen (avoid repeats)
  recentResults: boolean[]; // rolling last 10 results for accuracy_factor
  createdAt: number;        // Date.now() timestamp
  stateVersion: number;     // incremented on every answer, for optimistic locking
  lastAnswerAt: number;     // last answer timestamp for inactivity detection
  sessionId?: string;       // optional session identifier
}

export interface AnswerResponse {
  correct: boolean;
  correctIndex: number;
  scoreDelta: number;
  userState: PublicUserState;
  stateVersion: number;
}

export interface PublicUserState {
  difficulty: number;
  streak: number;
  maxStreak: number;
  totalScore: number;
  confidence: number;
}

export interface ScoreLeaderboardEntry {
  userId: string;
  username: string;
  totalScore: number;
  difficulty: number;
  streak: number;
}

export interface StreakLeaderboardEntry {
  userId: string;
  username: string;
  maxStreak: number;
  totalScore: number;
  difficulty: number;
}

export interface IdempotencyEntry {
  response: AnswerResponse;
  timestamp: number; // Date.now() when created
}

export interface AnswerLog {
  id: string;
  userId: string;
  questionId: string;
  difficulty: number;
  answer: number;        // selectedIndex
  correct: boolean;
  scoreDelta: number;
  streakAtAnswer: number;
  answeredAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RECENT_RESULTS_MAX_LENGTH = 10;
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Postgres owns user state now, so this is a cache lifetime, not a data lifetime.
// The old 24h value silently deleted the durable record it was standing in for.
const USER_STATE_CACHE_TTL = 60; // 1 minute

// ─── In-Memory Fallback Store ───────────────────────────────────────────────

const users = new Map<string, UserState>();
const idempotencyKeys = new Map<string, IdempotencyEntry>();
// Dev-only answer history (PG-down fallback). Newest-first, capped like the old LTRIM.
const answerLogsMem = new Map<string, AnswerLog[]>();
let redisAvailable = true;

// Initialize availability from client status and update on runtime events
// (the Redis client is created/auto-connected in `src/lib/redis.ts`; avoid calling `connect()` again)
redisAvailable = redis.status === 'ready';

redis.on('ready', () => {
  redisAvailable = true;
  // Reconcile the ranking zsets from Postgres on every (re)connect: a fresh or
  // flushed Redis comes back correct instead of empty. Best-effort, non-blocking.
  rebuildLeaderboards()
    .then((r) => console.log('[Redis] leaderboards reconciled from Postgres:', r))
    .catch((e) => console.error('[Redis] leaderboard rebuild failed:', e));
});

redis.on('end', () => {
  console.warn('Redis connection closed — switching to in-memory fallback');
  redisAvailable = false;
});

// ─── Postgres row mapping ───────────────────────────────────────────────────

const STATE_COLS = `user_id, difficulty, streak, max_streak, total_score, confidence,
                    last_question_id, answered_ids, recent_results, state_version,
                    last_answer_at, created_at, session_id`;

interface UserStateRow extends QueryResultRow {
  user_id: string;
  difficulty: number;
  streak: number;
  max_streak: number;
  total_score: number;
  confidence: number;
  last_question_id: string | null;
  answered_ids: string[];
  recent_results: boolean[];
  state_version: number;
  last_answer_at: Date | null;
  created_at: Date;
  session_id: string | null;
}

function rowToUserState(row: UserStateRow): UserState {
  return {
    userId: row.user_id,
    difficulty: row.difficulty,
    streak: row.streak,
    maxStreak: row.max_streak,
    totalScore: row.total_score,
    confidence: row.confidence,
    lastQuestionId: row.last_question_id,
    answeredIds: new Set(row.answered_ids),
    recentResults: row.recent_results,
    createdAt: row.created_at.getTime(),
    stateVersion: row.state_version,
    lastAnswerAt: (row.last_answer_at ?? row.created_at).getTime(),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
  };
}

/** Params for the UPDATE/INSERT column list, in order. Shared by save and the answer txn. */
export function userStateParams(user: UserState): unknown[] {
  return [
    user.userId,
    user.difficulty,
    user.streak,
    user.maxStreak,
    user.totalScore,
    user.confidence,
    user.lastQuestionId,
    Array.from(user.answeredIds),
    user.recentResults,
    user.lastAnswerAt,
    user.sessionId ?? null,
  ];
}

export const UPDATE_STATE_SET = `difficulty = $2, streak = $3, max_streak = $4,
    total_score = $5, confidence = $6, last_question_id = $7, answered_ids = $8,
    recent_results = $9, last_answer_at = to_timestamp($10 / 1000.0),
    session_id = $11, updated_at = NOW()`;

function newUserState(userId: string): UserState {
  return {
    userId,
    difficulty: 1,
    streak: 0,
    maxStreak: 0,
    totalScore: 0,
    confidence: 5,
    lastQuestionId: null,
    answeredIds: new Set<string>(),
    recentResults: [],
    createdAt: Date.now(),
    stateVersion: 0,
    lastAnswerAt: Date.now(),
  };
}

// ─── Redis as a derived cache/index (never the source of truth) ─────────────

/**
 * Mirror committed state into Redis: the read cache plus both ranking indexes.
 * Best-effort by design — Postgres already holds the truth, so a failure here
 * costs freshness, not data. ZADD writes an absolute score, so the next answer
 * fully repairs anything missed here.
 */
async function syncRedis(user: UserState): Promise<void> {
  if (!redisAvailable) return;
  try {
    await Promise.all([
      redis.setex(
        `user:state:${user.userId}`,
        USER_STATE_CACHE_TTL,
        JSON.stringify({ ...user, answeredIds: Array.from(user.answeredIds) })
      ),
      redis.zadd('leaderboard:score', user.totalScore, user.userId),
      redis.zadd('leaderboard:streak', user.maxStreak, user.userId),
    ]);
  } catch (err) {
    console.error('Redis sync failed (state is safe in Postgres):', err);
  }
}

async function readCache(userId: string): Promise<UserState | undefined> {
  if (!redisAvailable) return undefined;
  try {
    const data = await redis.get(`user:state:${userId}`);
    if (!data) return undefined;
    const parsed = JSON.parse(data);
    parsed.answeredIds = new Set(parsed.answeredIds || []);
    return parsed;
  } catch (err) {
    console.error('Redis error reading state cache, going to Postgres:', err);
    return undefined;
  }
}

// ─── User Helpers ───────────────────────────────────────────────────────────

/**
 * Returns the UserState for the given userId, creating the state row if the
 * account exists without one. The `users` row itself comes from login.
 */
export async function getOrCreateUser(userId: string): Promise<UserState> {
  const existing = await getUser(userId);
  if (existing) return existing;

  try {
    // DO UPDATE (not DO NOTHING) so the row is returned even under a race.
    const { rows } = await pool.query<UserStateRow>(
      `INSERT INTO user_state (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING ${STATE_COLS}`,
      [userId]
    );
    const user = rowToUserState(rows[0]);
    await syncRedis(user);
    return user;
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);

    console.error('Postgres error in getOrCreateUser, falling back to memory:', err);
    const cached = users.get(userId);
    if (cached) return cached;
    const user = newUserState(userId);
    users.set(userId, user);
    return user;
  }
}

/**
 * Get a user without creating. Returns undefined if not found.
 * Redis is consulted first as a cache; Postgres is the authority.
 */
export async function getUser(userId: string): Promise<UserState | undefined> {
  const cached = await readCache(userId);
  if (cached) return cached;

  try {
    const { rows } = await pool.query<UserStateRow>(
      `SELECT ${STATE_COLS} FROM user_state WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) return undefined;

    const user = rowToUserState(rows[0]);
    await syncRedis(user);
    return user;
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);

    console.error('Postgres error in getUser, falling back to memory:', err);
    return users.get(userId);
  }
}

/**
 * Persist an updated UserState. Postgres first, then Redis — the reverse order
 * could advertise a score that no durable store actually holds.
 *
 * Note: this bumps state_version unconditionally. The answer path does NOT use
 * it; that path needs a compare-and-set and runs its own atomic UPDATE.
 */
export async function saveUser(user: UserState): Promise<void> {
  try {
    await pool.query(
      `UPDATE user_state SET ${UPDATE_STATE_SET}, state_version = $12 WHERE user_id = $1`,
      [...userStateParams(user), user.stateVersion]
    );
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);

    console.error('Postgres error in saveUser, falling back to memory:', err);
    users.set(user.userId, user);
    return;
  }

  await syncRedis(user);
}

/**
 * Persist an updated UserState back into the store (alias for backwards compatibility).
 */
export async function updateUser(user: UserState): Promise<void> {
  return saveUser(user);
}

/**
 * Push a result onto the rolling recentResults window.
 * Enforces max length of 10 by shifting oldest entries.
 */
export function pushRecentResult(user: UserState, correct: boolean): void {
  user.recentResults.push(correct);
  while (user.recentResults.length > RECENT_RESULTS_MAX_LENGTH) {
    user.recentResults.shift();
  }
}

/**
 * Mark a question as answered by the user.
 */
export function markQuestionAnswered(user: UserState, questionId: string): void {
  user.answeredIds.add(questionId);
  user.lastQuestionId = questionId;
}

/**
 * Clear the answered set (used when all questions at a difficulty are exhausted).
 */
export function clearAnsweredIds(user: UserState): void {
  user.answeredIds.clear();
}

/**
 * Extract the public-facing subset of user state (no internal tracking fields).
 */
export function toPublicUserState(user: UserState): PublicUserState {
  return {
    difficulty: user.difficulty,
    streak: user.streak,
    maxStreak: user.maxStreak,
    totalScore: user.totalScore,
    confidence: user.confidence,
  };
}

// ─── Questions ──────────────────────────────────────────────────────────────

/**
 * Questions are a static in-process array (src/lib/questions.ts), so filtering
 * them costs nothing. This used to round-trip Redis to cache the result, which
 * was strictly slower than the work it avoided.
 */
export async function getQuestionsByDifficulty(difficulty: number, allQuestions: Question[]): Promise<Question[]> {
  return allQuestions.filter(q => q.difficulty === difficulty);
}

// ─── Leaderboard ────────────────────────────────────────────────────────────
// Redis sorted sets are the ranking index; Postgres is the source of truth for
// the displayed numbers and names. One zrevrange (order) + one PG join (data) —
// no N+1, and the shown score can never disagree with the stored score.

const SCORE_ZSET = 'leaderboard:score';
const STREAK_ZSET = 'leaderboard:streak';

interface LeaderboardRowPG extends QueryResultRow {
  user_id: string;
  username: string;
  total_score: number;
  max_streak: number;
  difficulty: number;
  streak: number;
}

const LEADERBOARD_SELECT = `s.user_id, u.username, s.total_score, s.max_streak, s.difficulty, s.streak
     FROM user_state s JOIN users u USING (user_id)`;

function toScoreEntry(r: LeaderboardRowPG): ScoreLeaderboardEntry {
  return { userId: r.user_id, username: r.username, totalScore: r.total_score, difficulty: r.difficulty, streak: r.streak };
}

function toStreakEntry(r: LeaderboardRowPG): StreakLeaderboardEntry {
  return { userId: r.user_id, username: r.username, maxStreak: r.max_streak, totalScore: r.total_score, difficulty: r.difficulty };
}

/** Join user_state + users for a set of ids, keyed by user_id (order applied by caller). */
async function fetchRowsByIds(ids: string[]): Promise<Map<string, LeaderboardRowPG>> {
  const { rows } = await pool.query<LeaderboardRowPG>(
    `SELECT ${LEADERBOARD_SELECT} WHERE s.user_id = ANY($1::uuid[])`,
    [ids]
  );
  return new Map(rows.map((r) => [r.user_id, r]));
}

/**
 * Top N by score: zset gives the ranked ids, one PG query fills the rows.
 * A zset member with no matching PG row is a genuine orphan and gets ZREM-ed
 * (repaired, not silently dropped as before). Redis down → PG is enough alone.
 */
export async function getScoreLeaderboard(limit: number = 10): Promise<ScoreLeaderboardEntry[]> {
  let ids: string[] | null = null;
  try {
    // Only the zrevrange is Redis — a throw here is a real Redis fault.
    if (redisAvailable) ids = await redis.zrevrange(SCORE_ZSET, 0, limit - 1);
  } catch (err) {
    console.error('Redis error in getScoreLeaderboard, using Postgres:', err);
    redisAvailable = false;
  }
  if (ids !== null) {
    // fetchRowsByIds is Postgres: kept OUT of the try above so a PG error can't
    // masquerade as a Redis outage and permanently disable the ranking path.
    if (ids.length === 0) return [];
    const byId = await fetchRowsByIds(ids);
    const orphans = ids.filter((id) => !byId.has(id));
    if (orphans.length) {
      redis.zrem(SCORE_ZSET, ...orphans).catch((e) => console.error('ZREM score orphans failed:', e));
    }
    return ids.filter((id) => byId.has(id)).map((id) => toScoreEntry(byId.get(id)!));
  }

  try {
    const { rows } = await pool.query<LeaderboardRowPG>(
      `SELECT ${LEADERBOARD_SELECT} ORDER BY s.total_score DESC LIMIT $1`,
      [limit]
    );
    return rows.map(toScoreEntry);
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);
    console.error('Postgres error in getScoreLeaderboard, falling back to memory:', err);
    return [...users.values()]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit)
      .map((u) => ({ userId: u.userId, username: u.userId, totalScore: u.totalScore, difficulty: u.difficulty, streak: u.streak }));
  }
}

/** Top N by max streak — identical strategy to getScoreLeaderboard. */
export async function getStreakLeaderboard(limit: number = 10): Promise<StreakLeaderboardEntry[]> {
  let ids: string[] | null = null;
  try {
    if (redisAvailable) ids = await redis.zrevrange(STREAK_ZSET, 0, limit - 1);
  } catch (err) {
    console.error('Redis error in getStreakLeaderboard, using Postgres:', err);
    redisAvailable = false;
  }
  if (ids !== null) {
    if (ids.length === 0) return [];
    const byId = await fetchRowsByIds(ids);
    const orphans = ids.filter((id) => !byId.has(id));
    if (orphans.length) {
      redis.zrem(STREAK_ZSET, ...orphans).catch((e) => console.error('ZREM streak orphans failed:', e));
    }
    return ids.filter((id) => byId.has(id)).map((id) => toStreakEntry(byId.get(id)!));
  }

  try {
    const { rows } = await pool.query<LeaderboardRowPG>(
      `SELECT ${LEADERBOARD_SELECT} ORDER BY s.max_streak DESC LIMIT $1`,
      [limit]
    );
    return rows.map(toStreakEntry);
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);
    console.error('Postgres error in getStreakLeaderboard, falling back to memory:', err);
    return [...users.values()]
      .sort((a, b) => b.maxStreak - a.maxStreak)
      .slice(0, limit)
      .map((u) => ({ userId: u.userId, username: u.userId, maxStreak: u.maxStreak, totalScore: u.totalScore, difficulty: u.difficulty }));
  }
}

/** A single user's leaderboard row (for the "you are here" line below the top N). */
export async function getScoreEntry(userId: string): Promise<ScoreLeaderboardEntry | null> {
  try {
    const row = (await fetchRowsByIds([userId])).get(userId);
    return row ? toScoreEntry(row) : null;
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);
    const u = users.get(userId);
    return u ? { userId, username: userId, totalScore: u.totalScore, difficulty: u.difficulty, streak: u.streak } : null;
  }
}

export async function getStreakEntry(userId: string): Promise<StreakLeaderboardEntry | null> {
  try {
    const row = (await fetchRowsByIds([userId])).get(userId);
    return row ? toStreakEntry(row) : null;
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);
    const u = users.get(userId);
    return u ? { userId, username: userId, maxStreak: u.maxStreak, totalScore: u.totalScore, difficulty: u.difficulty } : null;
  }
}

/** Rank via Postgres when Redis is unavailable: 1 + (# users strictly ahead). */
async function pgRank(userId: string, column: 'total_score' | 'max_streak'): Promise<number> {
  const me = await pool.query<{ v: number }>(
    `SELECT ${column} AS v FROM user_state WHERE user_id = $1`,
    [userId]
  );
  if (me.rows.length === 0) return -1;
  const { rows } = await pool.query<{ ahead: number }>(
    `SELECT COUNT(*) AS ahead FROM user_state WHERE ${column} > $1`,
    [me.rows[0].v]
  );
  return rows[0].ahead + 1; // COUNT is INT8 → number (db.ts parser)
}

/**
 * 1-based rank for a user; -1 if unranked. Redis zrevrank is O(log N); the PG
 * fallback keeps ranks correct when Redis is down.
 */
export async function getUserScoreRank(userId: string): Promise<number> {
  try {
    if (redisAvailable) {
      const rank = await redis.zrevrank(SCORE_ZSET, userId);
      return rank !== null ? rank + 1 : -1;
    }
  } catch (err) {
    console.error('Redis error in getUserScoreRank, using Postgres:', err);
    redisAvailable = false;
  }
  try {
    return await pgRank(userId, 'total_score');
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);
    const sorted = [...users.values()].sort((a, b) => b.totalScore - a.totalScore);
    const idx = sorted.findIndex((u) => u.userId === userId);
    return idx !== -1 ? idx + 1 : -1;
  }
}

export async function getUserStreakRank(userId: string): Promise<number> {
  try {
    if (redisAvailable) {
      const rank = await redis.zrevrank(STREAK_ZSET, userId);
      return rank !== null ? rank + 1 : -1;
    }
  } catch (err) {
    console.error('Redis error in getUserStreakRank, using Postgres:', err);
    redisAvailable = false;
  }
  try {
    return await pgRank(userId, 'max_streak');
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);
    const sorted = [...users.values()].sort((a, b) => b.maxStreak - a.maxStreak);
    const idx = sorted.findIndex((u) => u.userId === userId);
    return idx !== -1 ? idx + 1 : -1;
  }
}

/** Rank by score or streak. Thin dispatch over the two rank helpers. */
export async function getUserRank(userId: string, type: 'score' | 'streak'): Promise<number> {
  return type === 'score' ? getUserScoreRank(userId) : getUserStreakRank(userId);
}

let rebuildInFlight = false;

/**
 * Rebuild both ranking zsets from Postgres (the source of truth). Runs on every
 * Redis (re)connect and is exposed for scripts/rebuild-leaderboards.mjs.
 *
 * Idempotent: the zsets are rebuilt inside a MULTI so a reader never sees an
 * empty board mid-rebuild, and ZADD writes absolute scores so re-running is safe.
 * Guarded twice — an in-process flag and a short Redis NX lock — so overlapping
 * reconnect events and multiple app instances don't stampede.
 */
export async function rebuildLeaderboards(): Promise<{ rebuilt: number } | { skipped: string }> {
  if (rebuildInFlight) return { skipped: 'already running in this process' };
  rebuildInFlight = true;
  try {
    const lock = await redis.set('leaderboard:rebuild:lock', '1', 'EX', 30, 'NX');
    if (lock !== 'OK') return { skipped: 'another instance holds the rebuild lock' };

    const { rows } = await pool.query<{ user_id: string; total_score: number; max_streak: number }>(
      'SELECT user_id, total_score, max_streak FROM user_state'
    );

    // ponytail: whole table into one pipeline — trivial at this scale. Chunk the
    // ZADDs if user_state ever grows past ~10k rows.
    const multi = redis.multi();
    multi.del(SCORE_ZSET, STREAK_ZSET);
    for (const r of rows) {
      multi.zadd(SCORE_ZSET, r.total_score, r.user_id);
      multi.zadd(STREAK_ZSET, r.max_streak, r.user_id);
    }
    await multi.exec();
    return { rebuilt: rows.length };
  } finally {
    rebuildInFlight = false;
  }
}

// ─── Idempotency (in-memory dev fallback only) ──────────────────────────────
// Production idempotency is durable: the key is written inside the answer txn
// (see processAnswerAtomic). These Maps back only the PG-down dev fallback.

/**
 * Lazy cleanup: remove all idempotency entries older than the TTL.
 */
function cleanupExpiredIdempotencyKeys(): void {
  const now = Date.now();
  for (const [k, v] of idempotencyKeys) {
    if (now - v.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyKeys.delete(k);
    }
  }
}

// ─── Atomic Answer Transaction ──────────────────────────────────────────────

/** What the adaptive engine produces from a locked UserState — pure, no I/O. */
export interface AnswerComputation {
  response: AnswerResponse;
  log: AnswerLog;
}

export type ProcessAnswerResult =
  | { status: 'ok' | 'replay'; response: AnswerResponse }
  | { status: 'conflict'; currentVersion: number };

/** Internal signal: optimistic-lock mismatch. Rolls the txn back (idempotency key not consumed). */
class StateVersionConflict extends Error {
  constructor(public readonly currentVersion: number) {
    super('state version conflict');
  }
}

/**
 * Apply one answer atomically. Score write, answer_log, and idempotency key all
 * land in a single Postgres transaction or none do. `compute` is the pure
 * adaptive engine (see adaptive.ts) — it mutates the locked state and returns the
 * response + log, but performs no I/O of its own.
 *
 * - Idempotency key is reserved first: a replay short-circuits and applies nothing.
 * - `SELECT ... FOR UPDATE` serializes concurrent answers for the same user, so the
 *   in-code version compare is a true compare-and-set (closes the old TOCTOU race).
 * - Redis (cache + ranking zsets) is synced only after commit, best-effort.
 */
export async function processAnswerAtomic(
  userId: string,
  idempotencyKey: string,
  expectedVersion: number | undefined,
  compute: (user: UserState) => AnswerComputation
): Promise<ProcessAnswerResult> {
  try {
    const result = await withTransaction(async (client): Promise<
      { status: 'ok'; response: AnswerResponse; user: UserState } | { status: 'replay'; response: AnswerResponse }
    > => {
      // Reserve the idempotency key. A concurrent holder of the same key blocks
      // here until it commits, so a 0-row result always sees the final response.
      const reserved = await client.query(
        `INSERT INTO idempotency (key, user_id, response) VALUES ($1, $2, '{}'::jsonb)
           ON CONFLICT (key) DO NOTHING`,
        [idempotencyKey, userId]
      );
      if (reserved.rowCount === 0) {
        const prior = await client.query<{ response: AnswerResponse }>(
          'SELECT response FROM idempotency WHERE key = $1',
          [idempotencyKey]
        );
        // Normal replay. If the row is gone, a concurrent prune deleted a key
        // already past its 5-min window — fall through and reprocess (no crash).
        if (prior.rows.length > 0) {
          return { status: 'replay', response: prior.rows[0].response };
        }
      }

      // Lock the state row for the txn. Heal a missing row (account with no state yet).
      let locked = await client.query<UserStateRow>(
        `SELECT ${STATE_COLS} FROM user_state WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );
      if (locked.rows.length === 0) {
        await client.query(
          'INSERT INTO user_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
          [userId]
        );
        locked = await client.query<UserStateRow>(
          `SELECT ${STATE_COLS} FROM user_state WHERE user_id = $1 FOR UPDATE`,
          [userId]
        );
      }
      const user = rowToUserState(locked.rows[0]);

      if (expectedVersion !== undefined && user.stateVersion !== expectedVersion) {
        throw new StateVersionConflict(user.stateVersion);
      }

      const { response, log } = compute(user);

      await client.query(
        `UPDATE user_state SET ${UPDATE_STATE_SET}, state_version = $12 WHERE user_id = $1`,
        [...userStateParams(user), user.stateVersion]
      );
      await client.query(
        `INSERT INTO answer_log
           (id, user_id, question_id, difficulty, answer, correct, score_delta, streak_at_answer, answered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))`,
        [log.id, log.userId, log.questionId, log.difficulty, log.answer,
         log.correct, log.scoreDelta, log.streakAtAnswer, log.answeredAt]
      );
      // Upsert (not UPDATE): the reservation row is absent when we fell through
      // from a concurrently-pruned key, so the response would otherwise be lost.
      await client.query(
        `INSERT INTO idempotency (key, user_id, response) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET response = $3`,
        [idempotencyKey, userId, JSON.stringify(response)]
      );
      // ponytail: prune inline on every write — table is tiny (5-min window) and
      // idx_idempotency_created covers it. Move to a cron sweep if it ever grows.
      await client.query(`DELETE FROM idempotency WHERE created_at < NOW() - INTERVAL '5 minutes'`);

      return { status: 'ok', response, user };
    });

    if (result.status === 'ok') await syncRedis(result.user);
    return { status: result.status, response: result.response };
  } catch (err) {
    if (err instanceof StateVersionConflict) {
      return { status: 'conflict', currentVersion: err.currentVersion };
    }
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);

    // Fork to the in-memory store ONLY on a true outage. If PG still answers,
    // this was a real query error and the txn's commit state is unknown —
    // re-applying in memory would diverge the two stores for this user.
    if (await isDbReachable()) throw err;

    console.error('Postgres unreachable in processAnswerAtomic, falling back to memory:', err);
    return processAnswerMemory(userId, idempotencyKey, expectedVersion, compute);
  }
}

/** Dev-only fallback mirroring the txn against the in-memory Maps. */
function processAnswerMemory(
  userId: string,
  idempotencyKey: string,
  expectedVersion: number | undefined,
  compute: (user: UserState) => AnswerComputation
): ProcessAnswerResult {
  const prior = idempotencyKeys.get(idempotencyKey);
  if (prior && Date.now() - prior.timestamp <= IDEMPOTENCY_TTL_MS) {
    return { status: 'replay', response: prior.response };
  }

  let user = users.get(userId);
  if (!user) {
    user = newUserState(userId);
    users.set(userId, user);
  }

  if (expectedVersion !== undefined && user.stateVersion !== expectedVersion) {
    return { status: 'conflict', currentVersion: user.stateVersion };
  }

  const { response, log } = compute(user); // mutates the stored object in place
  idempotencyKeys.set(idempotencyKey, { response, timestamp: Date.now() });
  cleanupExpiredIdempotencyKeys();

  // Keep dev metrics working without Postgres: newest-first, capped at 100.
  const list = answerLogsMem.get(userId) ?? [];
  list.unshift(log);
  answerLogsMem.set(userId, list.slice(0, 100));

  return { status: 'ok', response };
}

// ─── Answer Log ─────────────────────────────────────────────────────────────

/**
 * Recent answer history for a user, newest first. Reads answer_log (Postgres),
 * which the atomic answer txn writes durably — no TTL, no LTRIM cap.
 */
export async function getAnswerLogs(userId: string, limit: number = 100): Promise<AnswerLog[]> {
  try {
    const { rows } = await pool.query<AnswerLogRow>(
      `SELECT id, user_id, question_id, difficulty, answer, correct,
              score_delta, streak_at_answer, answered_at
         FROM answer_log
        WHERE user_id = $1
        ORDER BY answered_at DESC
        LIMIT $2`,
      [userId, limit]
    );
    return rows.map(rowToAnswerLog);
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);
    console.error('Postgres error in getAnswerLogs, using in-memory dev log:', err);
    return (answerLogsMem.get(userId) ?? []).slice(0, limit);
  }
}

interface AnswerLogRow extends QueryResultRow {
  id: string;
  user_id: string;
  question_id: string;
  difficulty: number;
  answer: number;
  correct: boolean;
  score_delta: number;
  streak_at_answer: number;
  answered_at: Date;
}

function rowToAnswerLog(row: AnswerLogRow): AnswerLog {
  return {
    id: row.id,
    userId: row.user_id,
    questionId: row.question_id,
    difficulty: row.difficulty,
    answer: row.answer,
    correct: row.correct,
    scoreDelta: row.score_delta,
    streakAtAnswer: row.streak_at_answer,
    answeredAt: row.answered_at.getTime(),
  };
}

// ─── Store Reset (for testing) ──────────────────────────────────────────────

/**
 * Clears all data from the store. Used for testing only.
 */
export async function resetStore(): Promise<void> {
  users.clear();
  idempotencyKeys.clear();

  try {
    if (redisAvailable) {
      await redis.flushdb();
    }
  } catch (err) {
    console.error('Redis error in resetStore:', err);
  }
}
