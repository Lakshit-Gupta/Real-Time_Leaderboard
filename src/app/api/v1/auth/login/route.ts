// POST /api/v1/auth/login
// Create a new session with a username. No password required.

import { NextRequest, NextResponse } from "next/server";
import { createSession, validateUsername } from "@/lib/auth";
import { dbOutageResponse } from "@/lib/db";

interface LoginRequestBody {
  username?: string;
}

export async function POST(request: NextRequest) {
  let body: LoginRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { username } = body;

  if (!username) {
    return NextResponse.json(
      { error: "username is required" },
      { status: 400 }
    );
  }

  // Validate username
  const validation = validateUsername(username);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400 }
    );
  }

  // Create session
  let session;
  try {
    session = await createSession(username);
  } catch (err) {
    // Without Postgres we cannot mint a durable identity. Say so rather than
    // hand back a session whose progress would silently evaporate.
    const outage = dbOutageResponse(err);
    if (outage) return outage;
    throw err;
  }

  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    token: session.token,
    expiresAt: new Date(session.createdAt + 86400 * 1000).toISOString(),
  });
}
