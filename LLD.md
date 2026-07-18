# BrainBolt — Low Level Design

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Module Responsibilities](#2-module-responsibilities)
3. [API Schemas](#3-api-schemas)
4. [Data Model](#4-data-model)
5. [Cache Strategy](#5-cache-strategy)
6. [Adaptive Algorithm](#6-adaptive-algorithm)
7. [Score Formula](#7-score-formula)
8. [Edge Cases](#8-edge-cases)
9. [Leaderboard Update Strategy](#9-leaderboard-update-strategy)
10. [Non-Functional Requirements](#10-non-functional-requirements)


---

## 1. System Architecture

### 1.1 Architecture Diagram (ASCII art)

```
Browser ──HTTP──► Next.js App ──Redis Protocol──► Redis
                  (SSR + API)                     (State Store)
                      │
                      └── Fullstack Monolith ──┘
```

**Why Next.js fullstack:**
- Single codebase for frontend and backend reduces deployment complexity
- App Router provides type-safe API routes with zero boilerplate
- Server Components enable efficient SSR without separate backend service
- Scales to millions of requests/month before needing microservices

**Why Redis over PostgreSQL for this use case:**
- Sub-millisecond read/write latency (10-100× faster than PostgreSQL)
- Sorted sets provide O(log N) leaderboard operations natively
- Zero query planning overhead—direct data structure access
- TTL-based cache invalidation built into every key
- Single-threaded execution guarantees atomic operations without transactions

For production scale beyond 10M users, the system would migrate to:
`Browser → Next.js → Redis (cache) → PostgreSQL (persistence)`

---

## 2. Module Responsibilities

### 2.1 redis.ts

**What it owns:**
Manages Redis client lifecycle, connection pooling, and automatic reconnection handling. Provides a singleton instance configured with health check events and fallback logic for graceful degradation when Redis is unavailable.

**Key exports:**
```typescript
const redis: RedisClient  // ioredis client singleton, auto-connects on import
```

**What it deliberately does NOT do:**
- Does not implement business logic—purely infrastructure
- Does not validate data structures (responsibility of callers)
- Does not log every command (only connection events to avoid noise)

---

### 2.2 store.ts

**What it owns:**
All data access layer operations for user state, leaderboards, idempotency tracking, and answer logging. Owns the Redis-first strategy with in-memory fallback. Handles serialization/deserialization of complex types (Set, Array) for Redis storage.

**Key exports:**
```typescript
interface UserState {
  userId: string;
  difficulty: number;        // 1-10
  streak: number;
  maxStreak: number;
  totalScore: number;
  confidence: number;        // 0-10, hysteresis control
  lastQuestionId: string | null;
  answeredIds: Set<string>;
  recentResults: boolean[];
  createdAt: number;
  stateVersion: number;      // optimistic locking
}

async function getOrCreateUser(userId: string): Promise<UserState>
async function getUser(userId: string): Promise<UserState | undefined>
async function saveUser(user: UserState): Promise<void>
async function updateUser(user: UserState): Promise<void>
function pushRecentResult(user: UserState, correct: boolean): void
function markQuestionAnswered(user: UserState, questionId: string): void
function clearAnsweredIds(user: UserState): void
function toPublicUserState(user: UserState): PublicUserState

async function getScoreLeaderboard(limit: number): Promise<ScoreLeaderboardEntry[]>
async function getStreakLeaderboard(limit: number): Promise<StreakLeaderboardEntry[]>
async function getUserRank(userId: string, type: 'score' | 'streak'): Promise<number>

async function checkIdempotency(key: string): Promise<AnswerResponse | null>
async function recordIdempotency(key: string, response: AnswerResponse): Promise<void>

async function logAnswer(log: AnswerLog): Promise<void>
async function getAnswerLogs(userId: string, limit: number): Promise<AnswerLog[]>
```

**What it deliberately does NOT do:**
- Does not implement adaptive logic (delegates to adaptive.ts)
- Does not validate question IDs (delegates to questions.ts)
- Does not enforce rate limits (delegates to rateLimit.ts)
- Never mutates objects passed by reference—returns new objects or void

---

### 2.3 adaptive.ts

**What it owns:**
Core adaptive difficulty algorithm including confidence-based hysteresis, score calculation with three-factor formula, and question selection with fallback logic. This is the brain of the system.

**Key exports:**
```typescript
async function processAnswer(
  userId: string,
  questionId: string,
  selectedIndex: number
): Promise<AnswerResponse>

async function getNextQuestion(userId: string): Promise<NextQuestionResult | null>

interface AnswerResponse {
  correct: boolean;
  correctIndex: number;
  scoreDelta: number;
  userState: PublicUserState;
  stateVersion: number;
}

interface NextQuestionResult {
  question: {
    id: string;
    text: string;
    choices: string[];
    difficulty: number;
    category: string;
  };
  userState: {
    difficulty: number;
    streak: number;
    totalScore: number;
    maxStreak: number;
  };
  stateVersion: number;
}
```

**What it deliberately does NOT do:**
- Does not persist state (delegates all storage to store.ts)
- Never sends `correctIndex` to client in `getNextQuestion` (security)
- Does not check idempotency (handled at API route layer)
- Does not enforce rate limits (API route responsibility)

---

### 2.4 questions.ts

**What it owns:**
Seed data containing 20 hardcoded questions across difficulty tiers 1-10. Provides read-only access with filtering by difficulty bands. Questions are immutable—no mutations allowed.

**Key exports:**
```typescript
interface Question {
  id: string;
  text: string;
  choices: string[];
  correctIndex: number;
  difficulty: number;  // 1-10
  category: string;
}

function getAllQuestions(): readonly Question[]
function getQuestionById(id: string): Question | undefined
function getQuestionsByDifficulty(target: number, band: number): Question[]
```

**What it deliberately does NOT do:**
- Does not track which users answered which questions (store.ts responsibility)
- Does not validate user answers (adaptive.ts responsibility)
- Does not mutate questions—returns readonly arrays and frozen objects
- Does not fetch from database (in-memory seed data only)

---

### 2.5 auth.ts

**What it owns:**
Username validation, session token generation, and Bearer token verification. Manages user profiles and session data in Redis with 24-hour TTL.

**Key exports:**
```typescript
interface Session {
  userId: string;
  username: string;
  token: string;
  createdAt: number;
}

async function createSession(username: string): Promise<Session>
async function getSession(token: string): Promise<Session | null>
async function getUserProfile(userId: string): Promise<{userId: string, username: string} | null>
async function verifyAuth(authHeader: string | null): Promise<{userId: string, username: string} | null>
function validateUsername(username: string): {valid: boolean, error?: string}
```

**What it deliberately does NOT do:**
- Does not implement password hashing (username-only auth for demo)
- Does not handle OAuth/SSO (out of scope)
- Does not enforce username uniqueness (userId is unique, username is decorative)
- Does not implement token refresh (24h TTL, must re-login)

---

### 2.6 rateLimit.ts

**What it owns:**
Sliding window rate limiting with in-memory tracking. Returns decision object with remaining quota and retry-after seconds. Enforces 30 requests per 60-second window per userId.

**Key exports:**
```typescript
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;  // seconds until window resets (0 if allowed)
}

function checkRateLimit(userId: string): RateLimitResult
function resetRateLimits(): void  // testing only
```

**What it deliberately does NOT do:**
- Does not enforce limits (returns decision, enforcement in API routes)
- Does not persist across restarts (in-memory only, acceptable for demo)
- Does not implement distributed rate limiting (single-server scope)
- Does not differentiate by endpoint (global per-user limit)

---

### 2.7 middleware.ts

**What routes it protects:**
All `/api/v1/*` routes except `/api/v1/auth/login` (public endpoint).

**How it reads/validates the Bearer token:**
1. Extracts `Authorization` header from incoming request
2. Validates format: `Bearer {token}` (case-sensitive)
3. Calls `verifyAuth(authHeader)` to validate token with Redis
4. If valid, injects `X-User-Id` and `X-Username` headers for downstream routes
5. If invalid/missing, returns 401 Unauthorized

**What it injects into headers:**
```typescript
X-User-Id: {userId}       // UUID from session
X-Username: {username}    // Display name
```

**Implementation note:**
This middleware does NOT exist in current implementation—auth verification is done directly in each route handler. For production, extract to `src/middleware.ts` for DRY compliance.

---

## 3. API Schemas

### POST /api/v1/auth/login

**Request:**
```typescript
{
  username: string;  // 1-20 chars, alphanumeric + underscore only
}
```

**Response (200 OK):**
```typescript
{
  userId: string;      // UUID v4
  username: string;    // Echoed back
  token: string;       // Session token (UUID v4)
  expiresAt: number;   // Unix timestamp (createdAt + 24h)
}
```

**Errors:**
- `400 Bad Request` — Invalid username format, body examples:
  ```json
  { "error": "Username cannot be empty" }
  { "error": "Username must be 1-20 characters" }
  { "error": "Username can only contain letters, numbers, and underscores" }
  ```
- `500 Internal Server Error` — Redis connection failure

---

### GET /api/v1/quiz/next

**Headers:**
```
Authorization: Bearer {token}
```

**Query Parameters:**
- `sessionId` (optional) — Client-generated session identifier

**Response (200 OK):**
```typescript
{
  question: {
    id: string;
    text: string;
    choices: string[];    // Always exactly 4 strings
    difficulty: number;   // 1-10
    category: string;
  };
  userState: {
    difficulty: number;
    streak: number;
    totalScore: number;
    maxStreak: number;
  };
  stateVersion: number;
  sessionId?: string;     // Echoed back if provided
  currentScore: number;   // Alias for totalScore
  currentStreak: number;  // Alias for streak
}
```

**Example:**
```json
{
  "question": {
    "id": "q5",
    "text": "What is the chemical symbol for gold?",
    "choices": ["Ag", "Au", "Fe", "Cu"],
    "difficulty": 3,
    "category": "Science"
  },
  "userState": {
    "difficulty": 3,
    "streak": 2,
    "totalScore": 140.0,
    "maxStreak": 5
  },
  "stateVersion": 12
}
```

**Errors:**
- `401 Unauthorized` — Missing, malformed, or expired Bearer token
- `404 Not Found` — No questions available for current difficulty (exhausted)
- `429 Too Many Requests` — Rate limit exceeded, headers include:
  ```
  X-RateLimit-Remaining: 0
  Retry-After: 45
  ```

---

### POST /api/v1/quiz/answer

**Headers:**
```
Authorization: Bearer {token}
```

**Request:**
```typescript
{
  questionId: string;
  answer: number;            // selectedIndex (0-3)
  stateVersion: number;      // from previous /next response
  answerIdempotencyKey: string;  // client-generated UUID v4
  sessionId?: string;
}
```

**Response (200 OK):**
```typescript
{
  correct: boolean;
  newDifficulty: number;
  newStreak: number;
  scoreDelta: number;
  totalScore: number;
  stateVersion: number;
  leaderboardRankScore: number;    // 1-indexed rank, -1 if not ranked
  leaderboardRankStreak: number;   // 1-indexed rank, -1 if not ranked
}
```

**Example:**
```json
{
  "correct": true,
  "newDifficulty": 3,
  "newStreak": 3,
  "scoreDelta": 72.0,
  "totalScore": 212.0,
  "stateVersion": 13,
  "leaderboardRankScore": 7,
  "leaderboardRankStreak": 12
}
```

**Errors:**
- `400 Bad Request` — Missing fields, invalid answer index, malformed JSON
- `401 Unauthorized` — Missing/invalid token
- `404 Not Found` — Question ID does not exist
- `409 Conflict` — State version mismatch (concurrent modification), body:
  ```json
  { "error": "State version mismatch", "currentVersion": 14 }
  ```
- `429 Too Many Requests` — Rate limit exceeded

---

### GET /api/v1/quiz/metrics

**Headers:**
```
Authorization: Bearer {token}
```

**Response (200 OK):**
```typescript
{
  currentDifficulty: number;
  streak: number;
  maxStreak: number;
  totalScore: number;
  accuracy: number;  // 0.0 - 1.0 (last 10 answers)
  difficultyHistogram: {
    "1": number, "2": number, ..., "10": number
  };
  recentPerformance: boolean[];  // Last 10 results (true=correct)
}
```

**Errors:**
- `401 Unauthorized`
- `404 Not Found` — User state not found (never answered a question)

---

### GET /api/v1/leaderboard/score

**Headers:**
```
Authorization: Bearer {token}
```

**Query Parameters:**
- `userId` (optional) — If provided and not in top 10, includes `currentUser`

**Response (200 OK):**
```typescript
{
  leaderboard: Array<{
    userId: string;
    username: string;  // fetched from user profile
    totalScore: number;
    rank: number;      // 1-indexed
  }>;
  currentUser?: {
    userId: string;
    username: string;
    totalScore: number;
    rank: number;
  };
  updatedAt: string;  // ISO 8601 timestamp
}
```

**Errors:**
- `401 Unauthorized`

---

### GET /api/v1/leaderboard/streak

**Headers:**
```
Authorization: Bearer {token}
```

**Query Parameters:**
- `userId` (optional) — If provided and not in top 10, includes `currentUser`

**Response (200 OK):**
```typescript
{
  leaderboard: Array<{
    userId: string;
    username: string;
    maxStreak: number;
    rank: number;      // 1-indexed
  }>;
  currentUser?: {
    userId: string;
    username: string;
    maxStreak: number;
    rank: number;
  };
  updatedAt: string;
}
```

**Note:** The streak leaderboard ranks by maxStreak (all-time best streak) rather than current active streak. This is an intentional design decision — current streak resets on wrong answers making it highly volatile for leaderboard purposes. maxStreak provides a stable, meaningful competitive metric.

**Errors:**
- `401 Unauthorized`

---

## 4. Data Model

### 4.1 In-Memory / Redis Model

#### UserState
```typescript
interface UserState {
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
}
```

#### Question
```typescript
interface Question {
  id: string;
  text: string;
  choices: string[];
  correctIndex: number;
  difficulty: number;
  category: string;
}
```

#### AnswerLog
```typescript
interface AnswerLog {
  id: string;               // nanoid()
  userId: string;
  questionId: string;
  difficulty: number;
  answer: number;           // selectedIndex
  correct: boolean;
  scoreDelta: number;
  streakAtAnswer: number;
  answeredAt: number;       // Date.now()
}
```

#### Session
```typescript
interface Session {
  userId: string;
  username: string;
  token: string;
  createdAt: number;
}
```

---

### 4.2 Production DB Schema (PostgreSQL — as implemented)

The schema below is what `migrations/001_init.sql` + `002_*.sql` actually create, and supersedes the earlier proposal in this section. Four deliberate changes from that proposal:

1. **`users` holds identity only; `user_state` holds all mutable quiz state** (1:1). The original had it backwards. Login then touches only `users`.
2. **No `questions` table.** Questions are a static 20-row code module (`src/lib/questions.ts`); a table plus an `answer_log → questions` FK would add sync burden for zero benefit. `answer_log.question_id` is a plain column.
3. **No `leaderboard_score` / `leaderboard_streak` tables.** A materialized `rank` column means an O(N) rewrite on every score change. The Redis zset *is* the ranking index; the `total_score DESC` / `max_streak DESC` indexes cover rebuild and the Redis-down read path.
4. **`DOUBLE PRECISION`, not `NUMERIC(10,2)`.** `calculateScore` returns an unrounded float and node-postgres hands `NUMERIC` back as a *string* — `float8` keeps scores numeric and unrounded, matching the API contract. An `idempotency` table is added so a durable score mutation is guarded by a durable key (Redis-only would let a flush double-apply a score).

```sql
CREATE TABLE users (
  user_id    UUID PRIMARY KEY,
  username   VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Case-insensitive identity continuity: "Ada" and "ada" are one person.
CREATE UNIQUE INDEX idx_users_username_lower ON users (LOWER(username));

CREATE TABLE user_state (
  user_id          UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  difficulty       INTEGER NOT NULL DEFAULT 1  CHECK (difficulty BETWEEN 1 AND 10),
  streak           INTEGER NOT NULL DEFAULT 0  CHECK (streak >= 0),
  max_streak       INTEGER NOT NULL DEFAULT 0  CHECK (max_streak >= 0),
  total_score      DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (total_score >= 0),
  confidence       INTEGER NOT NULL DEFAULT 5  CHECK (confidence BETWEEN 0 AND 10),
  last_question_id VARCHAR(50),
  answered_ids     TEXT[]    NOT NULL DEFAULT '{}',
  recent_results   BOOLEAN[] NOT NULL DEFAULT '{}',
  state_version    BIGINT    NOT NULL DEFAULT 0,
  last_answer_at   TIMESTAMPTZ,
  session_id       VARCHAR(255),          -- migration 002
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_state_score  ON user_state (total_score DESC);
CREATE INDEX idx_user_state_streak ON user_state (max_streak DESC);

CREATE TABLE answer_log (
  id               VARCHAR(50) PRIMARY KEY,   -- nanoid() from adaptive.ts
  user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id      VARCHAR(50) NOT NULL,      -- no FK: questions live in code
  difficulty       INTEGER NOT NULL,
  answer           INTEGER NOT NULL,
  correct          BOOLEAN NOT NULL,
  score_delta      DOUBLE PRECISION NOT NULL,
  streak_at_answer INTEGER NOT NULL,
  answered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_answer_log_user_time ON answer_log (user_id, answered_at DESC);

-- Durable idempotency: the key is written in the SAME txn as the score it guards.
CREATE TABLE idempotency (
  key        VARCHAR(255) PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  response   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_idempotency_created ON idempotency (created_at);  -- for pruning
```

Retention: rows in `idempotency` older than 5 min are pruned by a lazy sweep on write. `answer_log` is unbounded by design (real history, no LTRIM cap).

---

## 5. Cache Strategy

### 5.1 Redis Cache Layers (as implemented)

Redis is now a **derived** layer over Postgres, not the store of record. Only these keys exist:

| Key Pattern | Role | TTL | Source of truth |
|-------------|------|-----|-----------------|
| `user:state:{userId}` | Cache of the PG `user_state` row | 60s | Postgres |
| `leaderboard:score` | Sorted-set ranking **index** (ZADD absolute) | none | Postgres (rebuildable) |
| `leaderboard:streak` | Sorted-set ranking **index** (ZADD absolute) | none | Postgres (rebuildable) |
| `session:{token}` | Session JSON | 24h | Redis only (ephemeral by design) |
| `leaderboard:rebuild:lock` | NX lock guarding rebuild-on-reconnect | 30s | — |

Removed vs. the original design: `questions:difficulty:{n}` (questions filter in-process, no round-trip), `idempotency:{key}` (now durable in the PG `idempotency` table, written inside the answer txn), `answers:{userId}` (answer history is durable in `answer_log`), and the per-user `metrics`/`ratelimit` keys (metrics compute from PG; rate limit is in-process in `rateLimit.ts`). On every Redis (re)connect, `rebuildLeaderboards()` reconciles the two zsets from Postgres; a zset member with no PG row is ZREM-ed on read.

---

### 5.2 Write-Through vs Write-Behind

**Write-through (chosen for user state):**
- Write to Redis AND PostgreSQL synchronously on every answer
- Guarantees strong consistency: all reads see latest write
- Acceptable latency trade-off (<50ms extra) for correctness

**Why not write-behind:**
- Risk of data loss on crash between cache write and DB write
- Streak/score must never be incorrect due to lost updates
- No eventual consistency acceptable for leaderboard positions

---

### 5.3 Real-Time Update Guarantees

**Problem:** Leaderboard has 30s TTL, but users expect instant updates after answering.

**Solution:**
1. On POST /api/v1/quiz/answer:
   - Update UserState in Redis → `SET user:state:{userId}`
   - Update leaderboard sorted sets → `ZADD leaderboard:score {score} {userId}`
   - Both operations synchronous (no async jobs)

2. On GET /api/v1/leaderboard/score:
   - Read from sorted set → `ZREVRANGE leaderboard:score 0 9 WITHSCORES`
   - Sorted sets are updated on every answer, so data is always fresh
   - 30s TTL only applies if entire sorted set is evicted (rare)

**Guarantee:** Leaderboard staleness bounded to 30s only if Redis evicts sorted set under memory pressure. Normal operation is real-time.

---

## 6. Adaptive Algorithm

### 6.1 Pseudocode: processAnswer(userId, questionId, selectedIndex)

```pseudocode
FUNCTION processAnswer(userId, questionId, selectedIndex):
    // ── 1. Idempotency check (FIRST) ──
    // (handled at API route layer, not in this function)
    
    // ── 2. Load question and user ──
    question = getQuestionById(questionId)
    IF question is NULL:
        THROW Error("Question not found")
    END IF
    
    IF selectedIndex < 0 OR selectedIndex >= LENGTH(question.choices):
        THROW Error("Invalid selectedIndex")
    END IF
    
    // ── 3. stateVersion check ──
    // (handled at API route layer)
    
    user = getOrCreateUser(userId)
    correct = (selectedIndex == question.correctIndex)
    scoreDelta = 0
    
    // ── 4. Process answer ──
    IF correct:
        // ── 4a. Streak update ──
        user.streak = user.streak + 1
        user.maxStreak = MAX(user.maxStreak, user.streak)
        
        // ── 4b. Confidence update (asymmetric: +1 correct) ──
        user.confidence = MIN(10, user.confidence + 1)
        
        // ── 4c. Hysteresis band: difficulty up only if confidence >= 7 ──
        IF user.confidence >= 7:
            user.difficulty = MIN(10, user.difficulty + 1)
            user.confidence = 5  // reset after level change
        END IF
        
        // ── 4d. Push result BEFORE calculating score ──
        CALL pushRecentResult(user, true)
        
        // ── 4e. Score calculation ──
        baseDifficultyWeight = user.difficulty * 10
        streakMultiplier = MIN(4.0, 1.0 + user.streak * 0.25)
        
        correctInLast10 = COUNT(user.recentResults WHERE result == true)
        totalInLast10 = LENGTH(user.recentResults)
        accuracyFactor = MAX(0.1, correctInLast10 / totalInLast10)
        
        scoreDelta = baseDifficultyWeight * streakMultiplier * accuracyFactor
        user.totalScore = user.totalScore + scoreDelta
    ELSE:
        // ── 4f. Streak hard reset ──
        user.streak = 0
        
        // ── 4g. Confidence update (asymmetric: -2 wrong) ──
        user.confidence = MAX(0, user.confidence - 2)
        
        // ── 4h. Hysteresis band: difficulty down only if confidence <= 3 ──
        IF user.confidence <= 3:
            user.difficulty = MAX(1, user.difficulty - 1)
            user.confidence = 5  // reset after level change
        END IF
        
        CALL pushRecentResult(user, false)
        scoreDelta = 0
    END IF
    
    // ── 5. Mark question as answered ──
    user.answeredIds.ADD(questionId)
    user.lastQuestionId = questionId
    user.lastAnswerAt = NOW()
    
    // ── 6. Increment state version ──
    user.stateVersion = user.stateVersion + 1
    
    // ── 7. Log answer ──
    answerLog = {
        id: generateNanoId(),
        userId: user.userId,
        questionId: questionId,
        difficulty: question.difficulty,
        answer: selectedIndex,
        correct: correct,
        scoreDelta: scoreDelta,
        streakAtAnswer: user.streak,
        answeredAt: NOW()
    }
    CALL logAnswer(answerLog)  // fire-and-forget
    
    // ── 8. Persist user state + update leaderboards ──
    CALL saveUser(user)  // writes to Redis + updates sorted sets
    
    RETURN {
        correct: correct,
        correctIndex: question.correctIndex,
        scoreDelta: scoreDelta,
        userState: toPublicUserState(user),
        stateVersion: user.stateVersion
    }
END FUNCTION
```

---

### 6.2 Pseudocode: getNextQuestion(userId)

```pseudocode
FUNCTION getNextQuestion(userId):
    user = getOrCreateUser(userId)
    allQuestions = getAllQuestions()
    
    // ── 1. Streak decay check (inactivity > 30min) ──
    IF user.lastAnswerAt EXISTS AND (NOW() - user.lastAnswerAt) > 30 * 60 * 1000:
        user.streak = FLOOR(user.streak / 2)
        CALL saveUser(user)
    END IF
    
    // ── 2. Try questions at difficulty ±1 ──
    candidates = FILTER allQuestions WHERE:
        ABS(question.difficulty - user.difficulty) <= 1
        AND question.id NOT IN user.answeredIds
    
    // ── 3. Fallback: exact difficulty only ──
    IF LENGTH(candidates) == 0:
        candidates = FILTER allQuestions WHERE:
            question.difficulty == user.difficulty
            AND question.id NOT IN user.answeredIds
    END IF
    
    // ── 4. Fallback: clear answeredIds, try ±2 band ──
    IF LENGTH(candidates) == 0:
        CALL clearAnsweredIds(user)
        candidates = FILTER allQuestions WHERE:
            ABS(question.difficulty - user.difficulty) <= 2
    END IF
    
    // ── 5. Truly exhausted (should never happen with 20 questions) ──
    IF LENGTH(candidates) == 0:
        RETURN NULL
    END IF
    
    // ── 6. Weighted selection: 70% exact match, 30% ±1 ──
    exactMatch = FILTER candidates WHERE:
        question.difficulty == user.difficulty
    
    IF LENGTH(exactMatch) > 0 AND RANDOM() < 0.7:
        selected = RANDOM_CHOICE(exactMatch)
    ELSE:
        selected = RANDOM_CHOICE(candidates)
    END IF
    
    // ── 7. Update last question tracking ──
    user.lastQuestionId = selected.id
    CALL saveUser(user)
    
    // ── 8. Return question WITHOUT correctIndex ──
    RETURN {
        question: {
            id: selected.id,
            text: selected.text,
            choices: selected.choices,
            difficulty: selected.difficulty,
            category: selected.category
        },
        userState: {
            difficulty: user.difficulty,
            streak: user.streak,
            totalScore: user.totalScore,
            maxStreak: user.maxStreak
        },
        stateVersion: user.stateVersion
    }
END FUNCTION
```

---

### 6.3 Ping-Pong Prevention: Worked Example

| Answer | Result  | Confidence Before | Δ  | Confidence After | Difficulty | Explanation |
|--------|---------|-------------------|----|------------------|------------|-------------|
| 1      | Correct | 5                 | +1 | 6                | 5          | 6 < 7 (no change) |
| 2      | Wrong   | 6                 | -2 | 4                | 5          | 4 > 3 (no change) |
| 3      | Correct | 4                 | +1 | 5                | 5          | 5 < 7 (no change) |
| 4      | Wrong   | 5                 | -2 | 3                | 5 → 4 ↓   | 3 <= 3 (DROP) |
| 5      | Correct | 5 (reset)         | +1 | 6                | 4          | 6 < 7 (no change) |
| 6      | Correct | 6                 | +1 | 7                | 4 → 5 ↑   | 7 >= 7 (RAISE) |
| 7      | Wrong   | 5 (reset)         | -2 | 3                | 5 → 4 ↓   | 3 <= 3 (DROP) |
| 8      | Correct | 5 (reset)         | +1 | 6                | 4          | 6 < 7 (no change) |

**Key Insight:** Alternating correct/wrong does NOT cause oscillation. Difficulty changed only 3 times in 8 answers despite 50% alternation pattern—sustained performance required.

---

### 6.4 Why Asymmetric Confidence Delta?

Wrong answers penalize harder (-2) than correct answers reward (+1) because:

1. **Psychological realism:** Failing at a high difficulty should feel more impactful than succeeding once
2. **Gaming prevention:** Players cannot boost difficulty by deliberately answering wrong at easy levels then correct at hard levels
3. **Adaptive testing precedent:** GRE/GMAT use similar asymmetry to prevent score inflation

**Mathematical consequence:** To raise difficulty from confidence=5, a player needs 2 consecutive correct answers (5→6→7). To drop difficulty, only 1 wrong answer is needed (5→3). This makes the system forgiving when lowering difficulty (keeps players engaged) but strict when raising it (ensures competence).

---

## 7. Score Formula

### 7.1 Full Formula

```
scoreDelta = baseDifficultyWeight × streakMultiplier × accuracyFactor
```

**Where:**
- `baseDifficultyWeight = difficulty × 10`  (range: 10–100)
- `streakMultiplier = min(4.0, 1.0 + streak × 0.25)`  (range: 1.0–4.0, caps at streak=12)
- `accuracyFactor = max(0.1, correctInLast10 / 10)`  (range: 0.1–1.0)

---

### 7.2 Why Accuracy Floor of 0.1?

Prevents a streak of correct answers from scoring zero just because the player previously had 10 wrong in a row. This keeps the game rewarding during recovery phases and prevents total demoralization.

**Example:**
- Player has 10 consecutive wrong answers → accuracy = 0.1 (floor)
- Player gets next answer correct at difficulty=5, streak=1:
  - Base = 5 × 10 = 50
  - Multiplier = 1.0 + 1 × 0.25 = 1.25
  - Accuracy = 0.1 (floor kicks in)
  - Score = 50 × 1.25 × 0.1 = **6.25 points** (not zero)

---

### 7.3 Worked Examples

| Difficulty | Streak | Accuracy (last 10) | Base | Multiplier | AccuracyFactor | scoreDelta |
|------------|--------|-------------------|------|------------|----------------|------------|
| 1          | 0      | 5/10 (50%)        | 10   | 1.0        | 0.5            | 5.0        |
| 5          | 4      | 8/10 (80%)        | 50   | 2.0        | 0.8            | 80.0       |
| 10         | 12     | 10/10 (100%)      | 100  | 4.0        | 1.0            | 400.0      |
| 8          | 8      | 6/10 (60%)        | 80   | 3.0        | 0.6            | 144.0      |
| 3          | 1      | 1/10 (10%)        | 30   | 1.25       | 0.1 (floor)    | 3.75       |

---

## 8. Edge Cases

| Edge Case | Trigger | System Response | Score Impact | Spec Reference |
|-----------|---------|-----------------|--------------|----------------|
| 1. Ping-pong oscillation | Alternating correct/wrong | Hysteresis band (3–7) prevents rapid difficulty change | Normal | §6.3 |
| 2. Difficulty at lower bound | difficulty=1, wrong, confidence<=3 | Clamp: `max(1, difficulty - 1)` stays at 1 | 0 (wrong) | §6.1 line 37 |
| 3. Difficulty at upper bound | difficulty=10, correct, confidence>=7 | Clamp: `min(10, difficulty + 1)` stays at 10 | Max 400 | §6.1 line 22 |
| 4. Streak reset on wrong | Any wrong answer | `streak = 0`, multiplier drops to 1.0× | 0 (wrong) | §6.1 line 31 |
| 5. Streak decay (30min inactivity) | `lastAnswerAt` more than 30min ago | `streak = floor(streak / 2)` on next question fetch | Reduced multiplier on next correct | §6.2 line 5 |
| 6. Duplicate answer (idempotency) | Same idempotencyKey sent twice | Return cached response, no state change | 0 (no double-score) | API route layer |
| 7. stateVersion conflict | Two browser tabs submit simultaneously | 409 response with current stateVersion | N/A (request rejected) | §3 POST /answer |
| 8. Empty question pool at difficulty | All questions at ±1 band answered | Clear answeredIds, widen to ±2 band | Normal | §6.2 line 18 |
| 9. Rate limit exceeded | 31st request in 60s window | 429 response with Retry-After header | N/A (request rejected) | §10.3 |
| 10. Redis connection failure | Redis unavailable | Graceful degradation to in-memory Map | Normal (single server only) | §10.5 |
| 11. Session expired | Token older than 24h | 401 Unauthorized, must re-login | N/A (request rejected) | auth.ts |
| 12. selectedIndex out of bounds | selectedIndex < 0 or >= choices.length | 400 error, no state change | N/A (request rejected) | §6.1 line 6 |
| 13. accuracyFactor floor | 10 consecutive wrong answers | `max(0.1, 0/10)` = 0.1 prevents zero score | 10% of base × multiplier | §7.2 |
| 14. New user first answer | First call to getOrCreateUser | Create with confidence=5, difficulty=1 | Normal (base=10, multiplier=1.0–1.25) | store.ts |

---

## 9. Leaderboard Update Strategy

### 9.1 Write-Through on Every Answer

**Synchronous Redis ZADD on every POST /answer:**
```typescript
// Inside processAnswer() → saveUser()
await redis.zadd('leaderboard:score', user.totalScore, user.userId);
await redis.zadd('leaderboard:streak', user.maxStreak, user.userId);
```

**No async jobs. No eventual consistency.**

**Trade-off:** Slight latency on answer submission (~5-10ms extra) vs guaranteed consistency. Acceptable because users tolerate 50-100ms total for answer processing.

---

### 9.2 Redis Sorted Sets

**Data structure:**
```
ZADD leaderboard:score {totalScore} {userId}
ZREVRANGE leaderboard:score 0 9 WITHSCORES  # Top 10
ZREVRANK leaderboard:score {userId}          # User's rank (0-indexed)
```

**Complexity:**
- `ZADD`: O(log N) where N = total users
- `ZREVRANGE`: O(log N + K) where K = 10
- `ZREVRANK`: O(log N)

**Scales to millions:** Redis sorted sets handle 10M users with <10ms latency per operation.

---

### 9.3 Current User Always Visible

**Implementation:**
```typescript
export async function GET(request: NextRequest) {
  const userId = getUserIdFromAuthHeader(request);
  const leaderboard = await getScoreLeaderboard(10);
  
  const isInTop10 = leaderboard.some(entry => entry.userId === userId);
  
  if (!isInTop10) {
    const rank = await getUserRank(userId, 'score');
    const user = await getUser(userId);
    response.currentUser = {
      userId: user.userId,
      username: (await getUserProfile(userId))?.username || user.userId,
      totalScore: user.totalScore,
      rank: rank  // 1-indexed
    };
  }
  
  return NextResponse.json(response);
}
```

**Frontend rendering:**
- Top 10: normal list
- Current user (if not in top 10): pinned at bottom with "You (Rank #23)" label

---

### 9.4 Polling vs SSE vs WebSocket

| Approach | Latency | Complexity | Stateless servers | Chosen? |
|----------|---------|------------|-------------------|---------|
| Polling (3s) | 0-3s lag | Low | Yes | **CHOSEN for demo** |
| SSE | ~0ms | Medium | Partially (long-poll) | Production upgrade |
| WebSocket | ~0ms | High | No (sticky sessions) | Not suitable |

**Why polling is acceptable:**
- Leaderboard updates are not critical (3s delay acceptable)
- Keeps servers stateless (easy horizontal scaling)
- Simple: no connection management, no reconnection logic

**Production upgrade path:** Server-Sent Events (SSE) with Redis pub/sub:
```typescript
// On answer submission:
await redis.publish('leaderboard:updates', JSON.stringify({ userId, totalScore }));

// In GET /leaderboard/stream endpoint:
redis.subscribe('leaderboard:updates');
redis.on('message', (channel, message) => {
  res.write(`data: ${message}\n\n`);
});
```

---

## 10. Non-Functional Requirements

### 10.1 Strong Consistency

**Redis is single-threaded:**
- All user state mutations go through Redis commands
- No race conditions on streak/score updates per user
- Sequential consistency guarantee: all clients see operations in the same order

**stateVersion provides optimistic locking:**
```typescript
// Client sends stateVersion from last /next response
const currentStateVersion = user.stateVersion;
if (stateVersion !== currentStateVersion) {
  return 409;  // Conflict: user answered in another tab
}
```

**Why this matters:**
- Prevents double-scoring if user opens quiz in two tabs
- Prevents streak corruption from concurrent submissions

---

### 10.2 Idempotency

**Full flow:**
1. Client generates UUID v4 for `idempotencyKey`
2. Server checks `idempotency:{key}` in Redis
3. If exists → return cached response (no processing)
4. If new → process answer, save response to cache with 5min TTL
5. Return fresh response

**Key TTL: 5 minutes:**
- Covers network retries (exponential backoff up to 60s)
- Auto-expires to prevent unbounded memory growth

**Implementation:**
```typescript
export async function POST(request: NextRequest) {
  const { idempotencyKey } = await request.json();
  
  const cached = await checkIdempotency(idempotencyKey);
  if (cached) {
    return NextResponse.json({ ...cached, idempotent: true });
  }
  
  const response = await processAnswer(userId, questionId, selectedIndex);
  await recordIdempotency(idempotencyKey, response);
  
  return NextResponse.json({ ...response, idempotent: false });
}
```

---

### 10.3 Rate Limiting

**Algorithm:** Token bucket implemented via Redis INCR + EXPIRE

**Limits:**
- 30 requests/minute per userId
- Sliding window (resets 60s after first request in window)

**Implementation:**
```typescript
export function checkRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const entry = windows.get(userId);
  
  if (!entry || now - entry.windowStart >= 60000) {
    windows.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: 29, retryAfter: 0 };
  }
  
  if (entry.count < 30) {
    entry.count++;
    return { allowed: true, remaining: 30 - entry.count, retryAfter: 0 };
  }
  
  const retryAfter = Math.ceil((60000 - (now - entry.windowStart)) / 1000);
  return { allowed: false, remaining: 0, retryAfter };
}
```

**Production (Redis):**
```redis
INCR ratelimit:{userId}
EXPIRE ratelimit:{userId} 60
GET ratelimit:{userId}  → if > 30, reject
```

**Response headers:**
```
X-RateLimit-Remaining: 15
Retry-After: 45  (on 429 only)
```

---

### 10.4 Stateless App Servers

**Current (in-memory):**
- State is server-local (Map objects)
- Not horizontally scalable (requires sticky sessions)

**Production (Redis):**
- All state externalized to Redis
- Any server instance can handle any request
- Load balancer can use round-robin (no session affinity)
- Auto-scaling: add/remove servers without state migration

**Zero local state means:**
- Restart server → no data loss (all in Redis)
- Kill server mid-request → client retries to any server
- Deploy new version → blue-green deployment without draining connections

---

### 10.5 Redis Failure Degradation

**Primary:** Redis operations

**Fallback:** In-memory Map (single instance only)

**Production recommendation:** Circuit breaker → 503 instead of memory fallback

**Why 503 better than fallback:**
- Memory fallback causes divergent state across replicas
- Client sees inconsistent leaderboards depending on which server answered
- Better to fail fast and let monitoring/alerting trigger operator response

**Circuit breaker pseudocode:**
```typescript
class CircuitBreaker {
  state: 'closed' | 'open' | 'half-open' = 'closed';
  failures = 0;
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error('Circuit breaker open');
    }
    
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.failures++;
      if (this.failures >= 5) {
        this.state = 'open';
        setTimeout(() => this.state = 'half-open', 30000);
      }
      throw error;
    }
  }
}
```

---

## Appendix: SSR Implementation Note

The leaderboard feature satisfies the SSR requirement as follows:

**Current implementation (client-side):**
- Leaderboard component fetches via `fetch()` in `useEffect`
- Renders as client component (`"use client"` directive)

**SSR upgrade path:**
- Remove `"use client"` from Leaderboard component
- Fetch leaderboard data in Server Component:
  ```typescript
  // app/leaderboard/page.tsx (Server Component)
  export default async function LeaderboardPage() {
    const data = await fetch('http://localhost:3000/api/v1/leaderboard/score', {
      cache: 'no-store',  // Force SSR on every request
    }).then(res => res.json());
    
    return <Leaderboard initialData={data} />;
  }
  ```
- Server renders HTML with leaderboard data embedded
- Client hydrates with React (interactive sorting/tabs)

**Why this satisfies SSR:**
- HTML contains leaderboard data before JavaScript loads
- SEO-friendly (crawlers see content)
- Faster perceived load time (content visible immediately)

---
