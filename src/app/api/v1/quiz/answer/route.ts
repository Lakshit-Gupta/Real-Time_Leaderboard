// POST /api/v1/quiz/answer
// Process an answer submission with idempotency enforcement. Rate-limited. Requires auth.

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { getUser, getUserScoreRank, getUserStreakRank } from "@/lib/store";
import { processAnswer } from "@/lib/adaptive";
import { getQuestionById } from "@/lib/questions";
import { dbOutageResponse } from "@/lib/db";

interface AnswerRequestBody {
  questionId?: string;
  selectedIndex?: number;
  idempotencyKey?: string;
  stateVersion?: number;
  sessionId?: string;
}

export async function POST(request: NextRequest) {
  // Verify authentication
  const auth = await verifyAuth(request.headers.get("Authorization"));
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = auth.userId;

  let body: AnswerRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { questionId, selectedIndex, idempotencyKey, stateVersion, sessionId } = body;

  // ── Validate required fields ──
  if (!questionId || selectedIndex === undefined || !idempotencyKey) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (typeof selectedIndex !== "number" || selectedIndex < 0) {
    return NextResponse.json(
      { error: "Invalid selectedIndex" },
      { status: 400 }
    );
  }

  // ── Verify question exists ──
  const question = getQuestionById(questionId);
  if (!question) {
    return NextResponse.json(
      { error: "Question not found" },
      { status: 404 }
    );
  }

  // ── Validate selectedIndex against question choices ──
  if (selectedIndex >= question.choices.length) {
    return NextResponse.json(
      { error: "Invalid selectedIndex" },
      { status: 400 }
    );
  }

  // ── Rate limit check ──
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: rateLimit.retryAfter },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rateLimit.retryAfter),
          "Retry-After": String(rateLimit.retryAfter),
        },
      }
    );
  }

  // Everything below touches Postgres; a prod outage surfaces as a 503.
  try {
    // ── Session ID validation (soft check with logging) ──
    if (sessionId) {
      const user = await getUser(userId);
      if (user && user.sessionId && user.sessionId !== sessionId) {
        console.warn(`[SessionMismatch] userId=${userId} expected=${user.sessionId} received=${sessionId}`);
      }
    }

    // ── Atomic answer: idempotency reservation, optimistic lock, score + log all
    //    commit in one Postgres transaction (see processAnswerAtomic). ──
    const result = await processAnswer(userId, questionId, selectedIndex, idempotencyKey, stateVersion);

    if (result.status === "conflict") {
      return NextResponse.json(
        { error: "State version mismatch", currentVersion: result.currentVersion },
        { status: 409 }
      );
    }

    const { response } = result;

    // ── Fetch leaderboard ranks ──
    const leaderboardRankScore = await getUserScoreRank(userId);
    const leaderboardRankStreak = await getUserStreakRank(userId);

    return NextResponse.json(
      {
        ...response,
        idempotent: result.status === "replay",
        leaderboardRankScore,
        leaderboardRankStreak,
        sessionId: sessionId || null,
        newDifficulty: response.userState.difficulty,
        newStreak: response.userState.streak,
        totalScore: response.userState.totalScore,
      },
      {
        headers: {
          "X-RateLimit-Remaining": String(rateLimit.remaining),
        },
      }
    );
  } catch (err) {
    const outage = dbOutageResponse(err);
    if (outage) return outage;
    throw err;
  }
}
