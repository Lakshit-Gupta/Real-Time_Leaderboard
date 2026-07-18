// GET /api/v1/quiz/next
// Returns the next question based on adaptive difficulty. Rate-limited. Requires auth.

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getNextQuestion } from "@/lib/adaptive";
import { verifyAuth } from "@/lib/auth";
import { dbOutageResponse } from "@/lib/db";

export async function GET(request: NextRequest) {
  // Verify authentication
  const auth = await verifyAuth(request.headers.get("Authorization"));

  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = auth.userId;
  
  // Read sessionId from query params
  const sessionId = request.nextUrl.searchParams.get('sessionId');

  // Rate limit check
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

  try {
    // Get next question via adaptive engine
    const result = await getNextQuestion(userId);

    if (!result) {
      return NextResponse.json(
        { error: "No questions available for current difficulty" },
        { status: 404 }
      );
    }

    // sessionId is echoed back for the caller's convenience only. It is NOT
    // persisted here: getOrCreateUser + saveUser was a full-row read-modify-write
    // with no version check, so it could clobber a concurrent answer commit.
    return NextResponse.json(
      {
        ...result,
        sessionId: sessionId || null,
        currentScore: result.userState.totalScore,
        currentStreak: result.userState.streak,
        difficulty: result.userState.difficulty,
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
