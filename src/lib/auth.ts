// ─── BrainBolt Simple Authentication ────────────────────────────────────────
// Username-based auth with session tokens stored in Redis (for API routes)

import redis from './redis';
import { ALLOW_MEMORY_FALLBACK, DatabaseUnavailableError, withTransaction } from './db';

export interface Session {
  userId: string;
  username: string;
  token: string;
  createdAt: number;
}

const SESSION_TTL = 86400; // 24 hours in seconds
const USERNAME_REGEX = /^[a-zA-Z0-9_]{1,20}$/;

// In-memory fallback (development only — see ALLOW_MEMORY_FALLBACK)
const sessions = new Map<string, Session>();
// Mirrors the users table's LOWER(username) unique index so dev behaves like prod.
const usernameToId = new Map<string, string>();
let redisAvailable = true;

// Initialize availability from client status and update on runtime events
// (client auto-connects in `src/lib/redis.ts`; avoid calling `connect()` here)
redisAvailable = redis.status === 'ready';

redis.on('ready', () => {
  redisAvailable = true;
});

redis.on('end', () => {
  redisAvailable = false;
});

/**
 * Generate a new session token
 */
function generateToken(): string {
  return crypto.randomUUID();
}

/**
 * Validate username format
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username || username.trim().length === 0) {
    return { valid: false, error: 'Username cannot be empty' };
  }

  if (username.length < 1 || username.length > 20) {
    return { valid: false, error: 'Username must be 1-20 characters' };
  }

  if (!USERNAME_REGEX.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  return { valid: true };
}

/**
 * Resolve a username to its durable userId, creating the account on first sight.
 *
 * This is what makes a score worth persisting: the same username always maps to
 * the same user_id, so a returning player finds their progress. Previously every
 * login minted a fresh UUID, which left durable data permanently unreachable.
 */
async function findOrCreateUserId(username: string): Promise<string> {
  try {
    return await withTransaction(async (client) => {
      const found = await client.query<{ user_id: string }>(
        'SELECT user_id FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
      );

      let userId = found.rows[0]?.user_id;

      if (!userId) {
        const inserted = await client.query<{ user_id: string }>(
          `INSERT INTO users (user_id, username) VALUES ($1, $2)
             ON CONFLICT (LOWER(username)) DO NOTHING
           RETURNING user_id`,
          [crypto.randomUUID(), username]
        );

        // No row back means a concurrent login won the race; read its winner.
        userId =
          inserted.rows[0]?.user_id ??
          (
            await client.query<{ user_id: string }>(
              'SELECT user_id FROM users WHERE LOWER(username) = LOWER($1)',
              [username]
            )
          ).rows[0].user_id;
      }

      // Idempotent: also heals an account whose state row somehow went missing.
      await client.query(
        'INSERT INTO user_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId]
      );

      return userId;
    });
  } catch (err) {
    if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError(err);

    console.error('Postgres error in findOrCreateUserId, falling back to memory:', err);
    const key = username.toLowerCase();
    const existing = usernameToId.get(key);
    if (existing) return existing;

    const userId = crypto.randomUUID();
    usernameToId.set(key, userId);
    return userId;
  }
}

/**
 * Create a new session for a username. The session token is fresh every login;
 * the identity behind it is not.
 */
export async function createSession(username: string): Promise<Session> {
  const userId = await findOrCreateUserId(username);
  const token = generateToken();
  const session: Session = {
    userId,
    username,
    token,
    createdAt: Date.now(),
  };

  try {
    if (redisAvailable) {
      await redis.setex(`session:${token}`, SESSION_TTL, JSON.stringify(session));
      return session;
    }
  } catch (err) {
    console.error('Redis error in createSession, falling back to memory:', err);
    redisAvailable = false;
  }

  // In-memory fallback
  sessions.set(token, session);
  return session;
}

/**
 * Get session by token
 */export async function getSession(token: string): Promise<Session | null> {
  if (!token) return null;

  try {
    if (redisAvailable) {
      const data = await redis.get(`session:${token}`);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    }
  } catch (err) {
    console.error('Redis error in getSession, falling back to memory:', err);
    redisAvailable = false;
  }

  return sessions.get(token) || null;
}

// Usernames now live in the Postgres `users` table; the leaderboard store joins
// them in directly (see getScoreLeaderboard). The old Redis `user:profile:*`
// cache and its getters are gone — they caused the "Anonymous" bug when the
// 24h profile TTL expired while state lived on.

/**
 * Verify auth token from header
 */
export async function verifyAuth(authHeader: string | null): Promise<{ userId: string; username: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const session = await getSession(token);

  if (!session) {
    return null;
  }

  return { userId: session.userId, username: session.username };
}
