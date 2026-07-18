"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ApiError,
    getNextQuestion,
    submitAnswer as submitAnswerRequest,
    uuid,
    type PublicUserState,
    type Question,
} from '@/lib/api';

const FEEDBACK_MS = 2000;
const RESYNC_MS = 1000;

export interface Feedback {
    correct: boolean;
    correctIndex: number;
    scoreDelta: number;
}

/** One answered question. Difficulty over time is not exposed by any endpoint,
 *  so the trace is accumulated here, for this session. */
export interface TracePoint {
    difficulty: number;
    confidence?: number;
    correct: boolean;
}

// No confidence: the API doesn't return it, and inventing a 5 would render as
// "holding steady" — a claim about the engine we can't actually make.
const INITIAL_STATS: PublicUserState = {
    totalScore: 0,
    streak: 0,
    maxStreak: 0,
    difficulty: 1,
};

export function useQuiz(token: string, onUnauthorized?: () => void) {
    const [question, setQuestion] = useState<Question | null>(null);
    const [stats, setStats] = useState<PublicUserState>(INITIAL_STATS);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [trace, setTrace] = useState<TracePoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Regenerated per question so a retry of the same answer is idempotent,
    // while a new question always gets a fresh key.
    const idempotencyKey = useRef('');
    const stateVersion = useRef(0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    const onUnauthorizedRef = useRef(onUnauthorized);
    useEffect(() => {
        onUnauthorizedRef.current = onUnauthorized;
    }, [onUnauthorized]);

    /** An expired or revoked token can't be retried out of — drop the session
     *  instead of leaving the user on a card that only ever errors. */
    const isExpiredSession = (err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
            onUnauthorizedRef.current?.();
            return true;
        }
        return false;
    };

    const clearTimers = () => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
    };
    useEffect(() => clearTimers, []);

    const loadQuestion = useCallback(async () => {
        if (!token) return;
        // A pending feedback timer is stale the moment we load a new question.
        clearTimers();
        setIsLoading(true);
        setError(null);
        setFeedback(null);
        setSelectedIndex(null);
        try {
            const data = await getNextQuestion(token);
            setQuestion(data.question);
            idempotencyKey.current = uuid();
            stateVersion.current = data.stateVersion ?? 0;
            if (data.userState) setStats((prev) => ({ ...prev, ...data.userState }));
        } catch (err) {
            if (isExpiredSession(err)) return;
            setQuestion(null);
            setError(err instanceof Error ? err.message : 'Could not load a question');
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadQuestion();
    }, [loadQuestion]);

    const submit = useCallback(async () => {
        if (!question || selectedIndex === null || isSubmitting || feedback) return;

        setIsSubmitting(true);
        try {
            const data = await submitAnswerRequest(token, {
                questionId: question.id,
                selectedIndex,
                stateVersion: stateVersion.current,
                idempotencyKey: idempotencyKey.current,
            });

            stateVersion.current = data.stateVersion ?? 0;
            setStats((prev) => ({ ...prev, ...data.userState }));
            setFeedback({
                correct: data.correct,
                correctIndex: data.correctIndex,
                scoreDelta: data.scoreDelta,
            });
            setTrace((prev) => [
                ...prev,
                {
                    difficulty: data.userState.difficulty,
                    confidence: data.userState.confidence,
                    correct: data.correct,
                },
            ]);

            timers.current.push(setTimeout(loadQuestion, FEEDBACK_MS));
        } catch (err) {
            if (isExpiredSession(err)) return;
            // 409 means another tab moved the state on; resync rather than fight it.
            if (err instanceof ApiError && err.status === 409) {
                setError('Your progress moved on somewhere else. Catching up…');
                timers.current.push(setTimeout(loadQuestion, RESYNC_MS));
            } else {
                setError(err instanceof Error ? err.message : 'Could not submit that answer');
            }
        } finally {
            setIsSubmitting(false);
        }
    }, [question, selectedIndex, isSubmitting, feedback, token, loadQuestion]);

    const select = useCallback(
        (index: number) => {
            if (!feedback) setSelectedIndex(index);
        },
        [feedback]
    );

    return {
        question,
        stats,
        trace,
        selectedIndex,
        feedback,
        isLoading,
        isSubmitting,
        error,
        select,
        submit,
        retry: loadQuestion,
    };
}
