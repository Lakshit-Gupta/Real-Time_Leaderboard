# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BrainBolt — adaptive quiz platform. Next.js (App Router, TypeScript, Tailwind) fullstack monolith. **Postgres is the durable source of truth; Redis is a derived cache + ranking index on top of it.** No test suite exists.

## Commands

```bash
npm run dev          # dev server at http://localhost:3000 (works with nothing running — in-memory fallback, dev only)
npm run build        # production build
npm run lint         # eslint
docker-compose up --build   # full stack: postgres + redis + app
docker-compose up postgres redis   # just the datastores for local dev
npm run db:migrate   # apply migrations/*.sql (needs DATABASE_URL / running Postgres)
npm run db:rebuild   # rebuild Redis ranking zsets from Postgres
npm run migrate:redis -- --dry-run   # backfill pre-Postgres Redis data into PG (idempotent)
```

Env vars: `DATABASE_URL` (default `postgres://brainbolt:brainbolt@localhost:5432/brainbolt`), `REDIS_URL` (default `redis://localhost:6379`). See `.env.example`.

## Architecture

Request flow: Browser → Next.js API routes (`src/app/api/v1/`) → `src/lib/` → Postgres (truth) + Redis (cache/index).

**Postgres is the source of truth; Redis is derived.** Writes go to Postgres first, then best-effort to Redis — never the reverse (Redis-first could advertise a score no durable store holds). `src/lib/db.ts` is the pg `Pool` singleton (mirrors `redis.ts`), with type parsers registered for INT8 and NUMERIC (both otherwise arrive as strings — the `state_version` BIGINT one silently 409s every answer if unparsed).

**Fallback is dev-only durability, not a production mode.** `ALLOW_MEMORY_FALLBACK = NODE_ENV !== 'production'`. In dev, a Postgres outage falls back to in-memory Maps so `npm run dev` needs no infrastructure. In production a required write that can't reach Postgres throws `DatabaseUnavailableError` → routes return **503** (via `dbOutageResponse`) rather than accept a write that would vanish. New store functions must follow this pattern: Postgres, then `syncRedis`, `catch → if (!ALLOW_MEMORY_FALLBACK) throw new DatabaseUnavailableError`.

- `src/lib/store.ts` — data access layer. `user_state` is Postgres-backed with a 60s Redis cache; leaderboards are Redis sorted sets (ranking index) resolved through a single Postgres join (no N+1); idempotency keys and the answer log are durable in Postgres. Data ownership and schema live in `LLD.md §4.2`.

**Scoring is deliberately simple** (`calculateScore` in `src/lib/adaptive.ts`, spec'd in LLD §7): `difficulty×10 × streakMultiplier(min(4, 1+streak×0.25)) × accuracyFactor(max(0.1, correctInLast10/10))`. An IRT+Elo Python microservice was tried and removed as over-engineered — don't reintroduce a scoring service.

**Auth is two-layered:** `src/middleware.ts` only checks Bearer-header *presence* on `/api/v1/*` (except `/auth/`) and lets requests with `x-internal-request: true` bypass it. Actual token verification happens per-route via `verifyAuth` in `src/lib/auth.ts` (session tokens in Redis, 24h TTL — sessions stay Redis-only; a Redis loss just forces a passwordless re-login, and identity/progress survive in Postgres). Login upserts a stable `users` row so the same username always resolves to the same `userId`. Adding a protected route requires calling `verifyAuth` — middleware alone is not auth.

**Concurrency safety on `/quiz/answer`:** the whole answer applies in one Postgres transaction (`processAnswerAtomic` in `store.ts`) — idempotency key reserved, `SELECT ... FOR UPDATE` on the state row, score + `answer_log` + idempotency response committed together, then a best-effort ZADD. `FOR UPDATE` serializes concurrent answers so the `stateVersion` compare is a true compare-and-set (mismatch → 409, e.g. two tabs). Idempotency is **durable** (the key is in the txn), so a Redis flush can't cause a double-applied score; retries replay the stored response. Token-bucket rate limit 30 req/min per user (`src/lib/rateLimit.ts`, 429 + `Retry-After`). The adaptive engine itself is a pure function of the locked state — keep it I/O-free.

**Adaptive difficulty** lives in `src/lib/adaptive.ts`: hidden confidence score 0–10 (+1 correct, −2 wrong), difficulty moves only at confidence ≥7 (up) or ≤3 (down), then confidence resets to 5. This hysteresis is deliberate (prevents difficulty ping-pong) — don't "simplify" it to direct difficulty adjustment.

`src/lib/redis.ts` is a singleton stored on `globalThis` to survive dev hot reloads; import it, never create new ioredis clients.

## Docs

- `README.md` — full API reference (v1 endpoints, request/response shapes, error codes) and score-formula rationale.
- `LLD.md` — low-level design: pseudocode, edge cases, cache strategy, schemas.
- README says "Next.js 15" but package.json is on Next 16 / React 19.
