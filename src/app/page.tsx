"use client";

import dynamic from 'next/dynamic';
import { Skeleton, SkeletonGroup } from '@/components/ui';
import { AppHeader } from '@/components/layout/AppHeader';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { QuizCard } from '@/components/quiz/QuizCard';
import StatsBar from '@/components/stats/StatsBar';
import { AbilityTrace } from '@/components/stats/AbilityTrace';
import { useSession } from '@/hooks/useSession';
import { useQuiz } from '@/hooks/useQuiz';

// Below the fold on mobile and never needed for first paint.
const LeaderboardPanel = dynamic(() => import('@/components/leaderboard/LeaderboardPanel'), {
    ssr: false,
    loading: () => (
        <SkeletonGroup label="Loading leaderboard" className="bb-card flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
            ))}
        </SkeletonGroup>
    ),
});

function Quiz({ session, onSignOut }: {
    session: { token: string; userId: string; username: string };
    onSignOut: () => void;
}) {
    const quiz = useQuiz(session.token, onSignOut);

    return (
        <div className="min-h-screen">
            <AppHeader username={session.username} onSignOut={onSignOut} />

            <main className="mx-auto max-w-6xl px-4 py-6">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="flex flex-col gap-6">
                        <StatsBar
                            score={quiz.stats.totalScore}
                            streak={quiz.stats.streak}
                            maxStreak={quiz.stats.maxStreak}
                        />
                        <QuizCard
                            question={quiz.question}
                            selectedIndex={quiz.selectedIndex}
                            feedback={quiz.feedback}
                            isLoading={quiz.isLoading}
                            isSubmitting={quiz.isSubmitting}
                            error={quiz.error}
                            onSelect={quiz.select}
                            onSubmit={quiz.submit}
                            onRetry={quiz.retry}
                        />
                    </div>

                    {/*
                      One instance only. The old layout mounted this twice (a
                      `hidden md:block` copy plus a mobile copy), so a phone ran
                      two 3s poll loops against a 30/min rate limit.
                    */}
                    <aside className="flex flex-col gap-6">
                        <AbilityTrace
                            trace={quiz.trace}
                            difficulty={quiz.stats.difficulty}
                            confidence={quiz.stats.confidence}
                        />
                        <LeaderboardPanel
                            userId={session.userId}
                            token={session.token}
                            onUnauthorized={onSignOut}
                        />
                    </aside>
                </div>
            </main>
        </div>
    );
}

export default function Page() {
    const { session, isRestoring, isSigningIn, error, signIn, signOut } = useSession();

    // Avoids flashing the login screen at an already-signed-in user.
    if (isRestoring) return <div className="min-h-screen" />;

    if (!session) {
        return <LoginScreen onSignIn={signIn} isSigningIn={isSigningIn} error={error} />;
    }

    return <Quiz session={session} onSignOut={signOut} />;
}
