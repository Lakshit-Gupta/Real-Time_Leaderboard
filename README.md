# BrainBolt — Adaptive Infinite Quiz Platform

## Quick Start (Single Command)

```bash
docker-compose up --build
```

Then open **[http://localhost:3000](http://localhost:3000)**

##  Demo
 Watch the working demo here:
[Watch Demo on YouTube](https://youtu.be/HS_IfB6BmDA)

---

## What This Is

BrainBolt is an intelligent adaptive quiz platform that responds to your performance in real-time. It uses a confidence-based hysteresis algorithm to prevent difficulty oscillation, combines streak multipliers with rolling accuracy factors for scoring, and maintains live leaderboards with Redis-backed persistence. Built with Next.js 15 as a fullstack application where API routes handle all backend logic.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 15 | SSR frontend + API routes backend (fullstack monolith) |
| UI Library | React 19 | Interactive components with Server Components support |
| Language | TypeScript | Type-safe development across frontend and backend |
| Database | Redis 7 | Low-latency state storage, sorted sets for leaderboards |
| Styling | Tailwind CSS | Utility-first responsive design with dark mode support |
| Containerization | Docker | Multi-stage builds for production deployment |

---

## Architecture

BrainBolt runs as a **monolithic Next.js application** where the framework handles both server-side rendering (SSR) for the frontend and API route handlers for the backend. All user state, leaderboards, answer logs, and session data live in Redis with TTL-based cache invalidation. The application servers are stateless—any instance can handle any request since all state resides in Redis. This enables horizontal scaling behind a load balancer with zero session affinity requirements.

```
Browser → Next.js App (SSR + API Routes) → Redis
```

---

## API Reference (v1)

### `POST /api/v1/auth/login`

**Authentication:** None (public endpoint)

**Request:**
```json
{
  "username": "alice_42"
}
```

**Response (200):**
```json
{
  "userId": "uuid-v4",
  "username": "alice_42",
  "token": "session-token-uuid",
  "expiresAt": 1234567890000
}
```

**Errors:**
- `400` — Invalid username format (must be 1-20 alphanumeric chars + underscore)
- `500` — Server error

---

### `GET /api/v1/quiz/next`

**Authentication:** `Authorization: Bearer {token}` (required)

**Query Parameters:**
- `sessionId` (optional) — Client-generated session identifier for multi-device support

**Response (200):**
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
    "totalScore": 140,
    "maxStreak": 5
  },
  "stateVersion": 12,
  "sessionId": "optional-session-id"
}
```

**Errors:**
- `401` — Unauthorized (missing/invalid token)
- `404` — No questions available for current difficulty
- `429` — Rate limit exceeded (>30 req/min)

**Headers:**
- `X-RateLimit-Remaining: 25`

---

### `POST /api/v1/quiz/answer`

**Authentication:** `Authorization: Bearer {token}` (required)

**Request:**
```json
{
  "questionId": "q5",
  "selectedIndex": 1,
  "stateVersion": 12,
  "idempotencyKey": "client-generated-uuid",
  "sessionId": "optional-session-id"
}
```

**Response (200):**
```json
{
  "correct": true,
  "correctIndex": 1,
  "scoreDelta": 72,
  "userState": {
    "difficulty": 3,
    "streak": 3,
    "maxStreak": 5,
    "totalScore": 212,
    "confidence": 6
  },
  "stateVersion": 13,
  "idempotent": false
}
```

**Errors:**
- `400` — Invalid request body (missing fields, selectedIndex out of bounds)
- `401` — Unauthorized
- `404` — Question not found
- `409` — State version mismatch (concurrent modification from another tab)
- `429` — Rate limit exceeded

**Headers:**
- `X-RateLimit-Remaining: 24`
- `Retry-After: 45` (on 429 only)

---

### `GET /api/v1/quiz/metrics`

**Authentication:** `Authorization: Bearer {token}` (required)

**Response (200):**
```json
{
  "currentDifficulty": 5,
  "streak": 3,
  "maxStreak": 8,
  "totalScore": 450,
  "accuracy": 0.75,
  "difficultyHistogram": {
    "1": 5, "2": 8, "3": 12, "4": 10, "5": 7,
    "6": 3, "7": 1, "8": 0, "9": 0, "10": 0
  },
  "recentPerformance": [true, true, false, true, true, true, false, true, true, true]
}
```

**Errors:**
- `401` — Unauthorized
- `404` — User not found

---

### `GET /api/v1/leaderboard/score`

**Authentication:** `Authorization: Bearer {token}` (required)

**Query Parameters:**
- `userId` (optional) — If provided and user is not in top 10, includes `currentUser` field

**Response (200):**
```json
{
  "leaderboard": [
    {
      "userId": "uuid-1",
      "username": "alice_42",
      "totalScore": 1200,
      "rank": 1
    },
    {
      "userId": "uuid-2",
      "username": "bob_99",
      "totalScore": 950,
      "rank": 2
    }
  ],
  "currentUser": {
    "userId": "uuid-self",
    "username": "charlie_7",
    "totalScore": 450,
    "rank": 15
  },
  "updatedAt": "2026-02-17T10:30:00.000Z"
}
```

**Errors:**
- `401` — Unauthorized

---

### `GET /api/v1/leaderboard/streak`

**Authentication:** `Authorization: Bearer {token}` (required)

**Query Parameters:**
- `userId` (optional) — If provided and user is not in top 10, includes `currentUser` field

**Response (200):**
```json
{
  "leaderboard": [
    {
      "userId": "uuid-1",
      "username": "alice_42",
      "maxStreak": 15,
      "rank": 1
    },
    {
      "userId": "uuid-2",
      "username": "bob_99",
      "maxStreak": 12,
      "rank": 2
    }
  ],
  "currentUser": {
    "userId": "uuid-self",
    "username": "charlie_7",
    "maxStreak": 8,
    "rank": 7
  },
  "updatedAt": "2026-02-17T10:30:00.000Z"
}
```

**Errors:**
- `401` — Unauthorized

---

## Adaptive Algorithm

### Confidence-Based Hysteresis

The system maintains a hidden **confidence score** (0–10) for each user that increases slowly on correct answers (+1) but drops sharply on mistakes (−2). Difficulty transitions only occur at extreme confidence thresholds: difficulty increases only when confidence ≥ 7, and decreases only when confidence ≤ 3. After any difficulty change, confidence resets to the neutral point (5).

This asymmetric design prevents **ping-pong oscillation** where alternating correct/wrong answers would cause difficulty to bounce repeatedly. To move up a level, a player must demonstrate sustained competence (4 consecutive correct answers from confidence 5). To drop down, only 2 wrong answers are needed—the system is more forgiving when lowering difficulty to keep players engaged rather than frustrated.

### Ping-Pong Prevention Proof

Consider a player alternating between correct and wrong answers starting at confidence 5:

1. **Correct** → confidence 6 → difficulty unchanged
2. **Wrong** → confidence 4 → difficulty unchanged  
3. **Correct** → confidence 5 → difficulty unchanged
4. **Wrong** → confidence 3 → difficulty **drops** (threshold breached)

The difficulty changed only **once** despite 4 answers because the hysteresis band (3 to 7) filtered rapid oscillations. Sustained performance in either direction is required to cross thresholds, which mirrors how real adaptive testing systems (GRE, GMAT) prevent noise from distorting difficulty estimates.

### Score Formula

Scores combine three factors to reward both skill and consistency:

```
scoreDelta = baseDifficultyWeight × streakMultiplier × accuracyFactor
```

**baseDifficultyWeight** = difficulty × 10 (range: 10–100)  
Higher difficulties yield more points per question to incentivize progression.

**streakMultiplier** = min(4.0, 1.0 + streak × 0.25) (range: 1.0–4.0, caps at streak=12)  
Consecutive correct answers compound scoring power, but the 4× cap prevents runaway inflation. A 12-question streak yields maximum multiplier; beyond that, players earn steady high scores without infinite scaling.

**accuracyFactor** = max(0.1, correctInLast10 / 10) (range: 0.1–1.0)  
Rolling accuracy over the last 10 answers scales scores to recent performance. The 0.1 floor ensures that even players on a cold streak still earn 10% of normal score on correct answers—this prevents total demoralization during recovery phases.

---

## Key Features

- **Adaptive Difficulty (1–10 scale):** Confidence-based hysteresis prevents oscillation
- **Streak Multiplier:** +0.25× per consecutive correct answer (caps at 4×)
- **Redis Caching:** TTL-based cache layers for user state, leaderboards, and metrics
- **Idempotent Answers:** Client-generated keys prevent double-scoring on retries
- **SSR Leaderboard:** Server-rendered React components fetch live data at request time
- **Dark Mode:** Theme toggle with `prefers-color-scheme` detection and localStorage persistence
- **Rate Limiting:** Token bucket via Redis (30 req/min per user)
- **Session-Based Auth:** Bearer tokens with 24-hour TTL stored in Redis
- **Answer Logging:** Append-only answer history for metrics and analysis
- **State Versioning:** Optimistic locking prevents concurrent tab conflicts

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── auth/
│   │       │   └── login/
│   │       │       └── route.ts          # POST /api/v1/auth/login
│   │       ├── quiz/
│   │       │   ├── next/
│   │       │   │   └── route.ts          # GET /api/v1/quiz/next
│   │       │   ├── answer/
│   │       │   │   └── route.ts          # POST /api/v1/quiz/answer
│   │       │   └── metrics/
│   │       │       └── route.ts          # GET /api/v1/quiz/metrics
│   │       └── leaderboard/
│   │           ├── score/
│   │           │   └── route.ts          # GET /api/v1/leaderboard/score
│   │           └── streak/
│   │               └── route.ts          # GET /api/v1/leaderboard/streak
│   ├── globals.css                       # Design tokens + Tailwind directives
│   ├── layout.tsx                        # Root layout with theme provider
│   └── page.tsx                          # Main quiz interface
├── components/
│   ├── QuizCard.tsx                      # Question display + answer submission
│   ├── Leaderboard.tsx                   # Score/streak tabs with polling
│   ├── StatsBar.tsx                      # Real-time difficulty/streak/score display
│   └── ThemeToggle.tsx                   # Dark mode toggle button
└── lib/
    ├── adaptive.ts                       # Core adaptive algorithm (processAnswer, getNextQuestion)
    ├── auth.ts                           # Session management (createSession, verifyAuth)
    ├── questions.ts                      # Question bank (20 questions, difficulty 1–10)
    ├── rateLimit.ts                      # Token bucket rate limiter
    ├── redis.ts                          # Redis client initialization
    └── store.ts                          # Data access layer (user state, leaderboards, idempotency)
```

---

## Development (no Docker)

Install dependencies and start the Next.js development server:

```bash
npm install
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000) with hot module replacement enabled.

For production builds:

```bash
npm run build
npm start
```

---

**See [LLD.md](LLD.md) for comprehensive technical documentation including pseudocode, edge cases, cache strategy, and database schemas.**
