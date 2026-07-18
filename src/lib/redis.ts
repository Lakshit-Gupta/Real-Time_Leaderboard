import Redis from 'ioredis';

declare global {
  var redis: Redis | undefined;
}

function createRedisClient(): Redis {
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    // Per-command: fail fast (3 tries) so a request never hangs on a dead Redis —
    // the store catches the error and serves from Postgres instead.
    maxRetriesPerRequest: 3,
    // Connection-level: retry forever with capped backoff. Returning null here (the
    // old behavior) permanently gave up after 3 attempts, so a process that started
    // without Redis — or outlived a Redis restart — never reconnected and the
    // rebuild-on-reconnect below could never fire.
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
    lazyConnect: false,
    enableOfflineQueue: false,
  });

  client.on('connect', () => {
    console.log('[Redis] Connected successfully');
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  client.on('reconnecting', () => {
    console.log('[Redis] Reconnecting...');
  });

  return client;
}

// Singleton: reuse existing connection across hot reloads in dev
// In production, module is only loaded once so this is equivalent
const redis: Redis = globalThis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.redis = redis;
}

export default redis;
