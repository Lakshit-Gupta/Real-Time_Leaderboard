"use client";

import { useCallback, useEffect, useState } from 'react';
import { login as loginRequest } from '@/lib/api';

const KEYS = {
    token: 'brainbolt_token',
    userId: 'brainbolt_userId',
    username: 'brainbolt_username',
} as const;

export interface Session {
    token: string;
    userId: string;
    username: string;
}

/**
 * Session lives in localStorage (unchanged from the original auth flow).
 * `isRestoring` exists so the login screen doesn't flash for a signed-in user
 * before the effect reads storage.
 */
export function useSession() {
    const [session, setSession] = useState<Session | null>(null);
    const [isRestoring, setIsRestoring] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSigningIn, setIsSigningIn] = useState(false);

    useEffect(() => {
        try {
            const token = localStorage.getItem(KEYS.token);
            const userId = localStorage.getItem(KEYS.userId);
            const username = localStorage.getItem(KEYS.username);
            if (token && userId && username) setSession({ token, userId, username });
        } catch {
            // Storage unavailable (private mode): fall through to the login screen.
        }
        setIsRestoring(false);
    }, []);

    const signIn = useCallback(async (username: string) => {
        setIsSigningIn(true);
        setError(null);
        try {
            const data = await loginRequest(username.trim());
            const next = { token: data.token, userId: data.userId, username: data.username };
            try {
                localStorage.setItem(KEYS.token, next.token);
                localStorage.setItem(KEYS.userId, next.userId);
                localStorage.setItem(KEYS.username, next.username);
            } catch {
                // Non-fatal: the session still works for this tab.
            }
            setSession(next);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not sign in');
        } finally {
            setIsSigningIn(false);
        }
    }, []);

    const signOut = useCallback(() => {
        Object.values(KEYS).forEach((key) => {
            try {
                localStorage.removeItem(key);
            } catch {
                // Ignore: clearing state below is what matters.
            }
        });
        setSession(null);
    }, []);

    return { session, isRestoring, isSigningIn, error, signIn, signOut };
}
