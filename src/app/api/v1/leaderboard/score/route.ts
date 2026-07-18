// GET /api/v1/leaderboard/score
// Returns top 10 users by totalScore. Requires auth.

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getScoreLeaderboard, getUserRank, getScoreEntry } from "@/lib/store";
import { dbOutageResponse } from "@/lib/db";

interface LeaderboardRow {
  userId: string;
  username: string;
  rank: number;
  totalScore: number;
  difficulty: number;
  streak: number;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
  currentUser?: LeaderboardRow;
  updatedAt: string;
}

export async function GET(request: NextRequest) {
  // Verify authentication
  const isInternal = request.headers.get("x-internal-request") === "true";
  let userId: string | undefined;

  if (!isInternal) {
    const auth = await verifyAuth(request.headers.get("Authorization"));
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = auth.userId;
  }

  try {
    const entries = await getScoreLeaderboard(10);

    // The store already joined in usernames; zset order is the ranking.
    const leaderboard: LeaderboardRow[] = entries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    const response: LeaderboardResponse = {
      leaderboard,
      updatedAt: new Date().toISOString(),
    };

    // If userId provided and user is NOT in top 10, add currentUser
    if (userId) {
      const rank = await getUserRank(userId, "score");
      const isInTop10 = leaderboard.some((entry) => entry.userId === userId);

      if (rank > 0 && !isInTop10) {
        const entry = await getScoreEntry(userId);
        if (entry) {
          response.currentUser = { ...entry, rank };
        }
      }
    }

    return NextResponse.json(response);
  } catch (err) {
    const outage = dbOutageResponse(err);
    if (outage) return outage;
    throw err;
  }
}
