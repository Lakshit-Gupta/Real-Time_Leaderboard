// ─── BrainBolt PostgreSQL Client ────────────────────────────────────────────
// Durable source of truth. Redis (src/lib/redis.ts) is a derived index/cache
// on top of this — never the other way round.

import { Pool, types } from 'pg';
import { NextResponse } from 'next/server';

declare global {
  var pgPool: Pool | undefined;
}

// node-postgres hands back the wide numeric types as *strings* to avoid
// precision loss. Both would break us silently if left alone:
//
//   BIGINT  -> state_version arrives as "42", and "42" !== 42, so the
//              optimistic-lock check would mismatch on every single answer
//              and return 409 forever. Safe to parse: versions and scores
//              stay far below Number.MAX_SAFE_INTEGER.
//   NUMERIC -> would turn totalScore from a number into a string in the API
//              response. Scores use DOUBLE PRECISION precisely to avoid this;
//              the parser is a guard in case a NUMERIC column ever creeps in.
types.setTypeParser(types.builtins.INT8, (value: string) => parseInt(value, 10));
types.setTypeParser(types.builtins.NUMERIC, (value: string) => parseFloat(value));

function createPool(): Pool {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://brainbolt:brainbolt@localhost:5432/brainbolt',
    max: 10,
    idleTimeoutMillis: 30_000,
    // Fail fast rather than hanging a request behind a dead database.
    connectionTimeoutMillis: 5_000,
  });

  // An idle client erroring out must not take the process down.
  pool.on('error', (err) => {
    console.error('[Postgres] Idle client error:', err.message);
  });

  return pool;
}

// Singleton: survives dev hot reloads, same rationale as the Redis client.
const pool: Pool = globalThis.pgPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

/**
 * In production Postgres is mandatory: a durable write we cannot persist must
 * fail loudly rather than land in a Map that vanishes on restart. Development
 * keeps the in-memory fallback so `npm run dev` still needs no infrastructure.
 */
export const ALLOW_MEMORY_FALLBACK = process.env.NODE_ENV !== 'production';

/** Thrown when Postgres is required but unreachable. Routes turn this into a 503. */
export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Database unavailable');
    this.name = 'DatabaseUnavailableError';
    this.cause = cause;
  }
}

/** Standard 503 for a production Postgres outage. Returns null for any other error. */
export function dbOutageResponse(err: unknown): NextResponse | null {
  if (err instanceof DatabaseUnavailableError) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503, headers: { 'Retry-After': '5' } }
    );
  }
  return null;
}

/** True when Postgres answered a trivial query. Used to decide prod 503 vs dev fallback. */
export async function isDbReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `fn` inside a transaction on a single client, committing on success and
 * rolling back on any throw. The answer path needs this: the score write, the
 * answer log, and the idempotency key must land together or not at all.
 */
export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      // Rollback can fail if the connection already died; the original error matters more.
    });
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
