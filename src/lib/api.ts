/**
 * The single client for the v1 API. Owns the Bearer header and error shaping so
 * components never hand-roll fetch again.
 */

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
