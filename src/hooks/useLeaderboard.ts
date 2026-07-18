"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getLeaderboard, type LeaderboardEntry } from '@/lib/api';

const POLL_MS = 3000;

export type Board = 'score' | 'streak';

/** Rows are value objects, so a field-wise compare is enough to tell a poll
 *  that changed nothing from one that did. */
function sameEntries(a: LeaderboardEntry[], b: LeaderboardEntry[]) {
    return (
        a.length === b.length &&
        a.every((x, i) => {
            const y = b[i];
            return (
                x.userId === y.userId &&
                x.rank === y.rank &&
                x.totalScore === y.totalScore &&
                x.maxStreak === y.maxStreak &&
                x.username === y.username
            );
        })
    );
}

/**
 * Owns leaderboard polling for the whole app. Mount this once — a second
 * instance means a second poll loop.
 *
 * Polling pauses while the tab is hidden and refreshes immediately on return,
 * so a backgrounded tab stops burning requests against the 30/min rate limit.
 */
export function useLeaderboard(token: string, board: Board, onUnauthorized?: () => void) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [currentUser, setCurrentUser] = useState<LeaderboardEntry | null>(null);
    const [updatedAt, setUpdatedAt] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Only the first load blocks on a skeleton; polls refresh in place so the
    // board never flashes while the user is reading it.
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    // Polls overlap: a slow request for the previous board (or the previous
    // tick) must not overwrite a newer response. Only the latest request wins.
    const latestRequest = useRef(0);

    const onUnauthorizedRef = useRef(onUnauthorized);
    useEffect(() => {
        onUnauthorizedRef.current = onUnauthorized;
    }, [onUnauthorized]);

    const refresh = useCallback(async () => {
        if (!token) return;
        const requestId = ++latestRequest.current;
        try {
            const data = await getLeaderboard(token, board);
            if (requestId !== latestRequest.current) return;

            const next = data.leaderboard ?? [];
            // Keep the previous array when nothing moved, so memoized rows and
            // the rank animation stop re-running every 3s on identical data.
            setEntries((prev) => (sameEntries(prev, next) ? prev : next));
            setCurrentUser(data.currentUser ?? null);
            setUpdatedAt(Date.now());
            setError(null);
        } catch (err) {
            if (requestId !== latestRequest.current) return;
            if (err instanceof ApiError && err.status === 401) {
                onUnauthorizedRef.current?.();
                return;
            }
            setError(err instanceof Error ? err.message : 'Could not load the board');
        } finally {
            if (requestId === latestRequest.current) setIsInitialLoad(false);
        }
    }, [token, board]);

    // Switching board should show its data immediately, not the previous board's.
    useEffect(() => {
        setIsInitialLoad(true);
        setEntries([]);
        refresh();
    }, [board, refresh]);

    useEffect(() => {
        if (!token) return;

        let interval: ReturnType<typeof setInterval> | null = null;

        const start = () => {
            if (interval === null) interval = setInterval(refresh, POLL_MS);
        };
        const stop = () => {
            if (interval !== null) {
                clearInterval(interval);
                interval = null;
            }
        };

        const onVisibility = () => {
            if (document.hidden) {
                stop();
            } else {
                refresh();
                start();
            }
        };

        if (!document.hidden) start();
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [token, refresh]);

    return { entries, currentUser, updatedAt, error, isInitialLoad, refresh };
}
