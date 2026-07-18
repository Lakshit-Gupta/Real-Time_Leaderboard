// GET /api/v1/quiz/metrics
// Returns metrics for the authenticated user. Requires auth.

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getUser, getAnswerLogs } from "@/lib/store";
import { dbOutageResponse } from "@/lib/db";

export async function GET(request: NextRequest) {
  // Verify authentication
  const auth = await verifyAuth(request.headers.get("Authorization"));
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = auth.userId;

  try {
  const user = await getUser(userId);

  if (!user) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 404 }
    );
  }

  // Get answer logs
  const answerLogs = await getAnswerLogs(userId, 100);

  // Calculate accuracy
  const totalAnswers = user.recentResults.length;
  const correctAnswers = user.recentResults.filter(Boolean).length;
  const accuracy = totalAnswers > 0
    ? parseFloat((correctAnswers / totalAnswers).toFixed(2))
    : 0;

  // Build difficulty histogram
  const difficultyHistogram: Record<string, number> = {
    "1": 0, "2": 0, "3": 0, "4": 0, "5": 0,
    "6": 0, "7": 0, "8": 0, "9": 0, "10": 0
  };

  answerLogs.forEach(log => {
    const key = String(log.difficulty);
    if (key in difficultyHistogram) {
      difficultyHistogram[key]++;
    }
  });

  // Recent performance (last 10 answers)
  const recentPerformance = user.recentResults.slice(-10);

  const metrics = {
    currentDifficulty: user.difficulty,
    streak: user.streak,
    maxStreak: user.maxStreak,
    totalScore: user.totalScore,
    accuracy,
    difficultyHistogram,
    recentPerformance,
  };

  return NextResponse.json(metrics);
  } catch (err) {
    const outage = dbOutageResponse(err);
    if (outage) return outage;
    throw err;
  }
}
