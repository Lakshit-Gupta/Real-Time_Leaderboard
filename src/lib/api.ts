/**
 * The single client for the v1 API. Owns the Bearer header and error shaping so
 * components never hand-roll fetch again.
 */

/**
 * UUID for the idempotency key. `crypto.randomUUID` only exists in a secure
 * context (HTTPS or localhost) — over a plain-HTTP LAN IP it's undefined, which
 * crashed quiz loading. `getRandomValues` has no such restriction, so fall back
 * to a hand-built v4. The key needs uniqueness, not cryptographic secrecy.
 */
export function uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
        response = await fetch(path, {
            ...init,
            headers: {
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                Authorization: `Bearer ${token}`,
                ...init.headers,
            },
        });
    } catch {
        // Network-level failure: no response at all.
        throw new ApiError('Cannot reach the server. Check your connection.', 0);
    }

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status);
    }

    return response.json() as Promise<T>;
}

// ─── Types mirrored from the API responses ──────────────────────────────────

export interface PublicUserState {
    difficulty: number;
    streak: number;
    maxStreak: number;
    totalScore: number;
    confidence?: number;
}

export interface Question {
    id: string;
    text: string;
    choices: string[];
    difficulty: number;
    category: string;
}

export interface NextQuestionResponse {
    question: Question;
    userState: PublicUserState;
    stateVersion: number;
}

export interface AnswerResponse {
    correct: boolean;
    correctIndex: number;
    scoreDelta: number;
    userState: PublicUserState;
    stateVersion: number;
    idempotent?: boolean;
}

export interface LeaderboardEntry {
    userId: string;
    username: string;
    rank: number;
    totalScore: number;
    maxStreak?: number;
    streak?: number;
    difficulty: number;
}

export interface LeaderboardResponse {
    leaderboard: LeaderboardEntry[];
    currentUser?: LeaderboardEntry;
    updatedAt: string;
}

export interface LoginResponse {
    userId: string;
    username: string;
    token: string;
    expiresAt: number;
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function login(username: string): Promise<LoginResponse> {
    const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ApiError(body?.error ?? 'Could not sign in', response.status);
    }
    return response.json();
}

export function getNextQuestion(token: string) {
    return request<NextQuestionResponse>('/api/v1/quiz/next', token);
}

export function submitAnswer(
    token: string,
    payload: {
        questionId: string;
        selectedIndex: number;
        stateVersion: number;
        idempotencyKey: string;
    }
) {
    return request<AnswerResponse>('/api/v1/quiz/answer', token, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export function getLeaderboard(token: string, board: 'score' | 'streak') {
    return request<LeaderboardResponse>(`/api/v1/leaderboard/${board}`, token);
}
