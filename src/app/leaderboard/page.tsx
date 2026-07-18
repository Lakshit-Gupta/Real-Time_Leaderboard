import Link from 'next/link';
import { Avatar, Card, EmptyState, ErrorState, RankBadge } from '@/components/ui';
import { AppHeader } from '@/components/layout/AppHeader';
import { formatScore } from '@/lib/format';

// Rendered per request so the board is current on every visit.
export const dynamic = 'force-dynamic';

interface Row {
    userId: string;
    username: string;
    rank: number;
    totalScore: number;
    maxStreak?: number;
    difficulty: number;
}

async function getBoards(): Promise<{ scores: Row[]; streaks: Row[]; failed: boolean }> {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const headers = { 'x-internal-request': 'true' };

    try {
        const [scoreRes, streakRes] = await Promise.all([
            fetch(`${baseUrl}/api/v1/leaderboard/score`, { cache: 'no-store', headers }),
            fetch(`${baseUrl}/api/v1/leaderboard/streak`, { cache: 'no-store', headers }),
        ]);

        if (!scoreRes.ok || !streakRes.ok) return { scores: [], streaks: [], failed: true };

        const [scoreData, streakData] = await Promise.all([scoreRes.json(), streakRes.json()]);
        return {
            scores: scoreData.leaderboard ?? [],
            streaks: streakData.leaderboard ?? [],
            failed: false,
        };
    } catch {
        // A fetch failure must not masquerade as an empty board.
        return { scores: [], streaks: [], failed: true };
    }
}

function Board({
    title,
    rows,
    metric,
    failed,
}: {
    title: string;
    rows: Row[];
    metric: 'score' | 'streak';
    failed: boolean;
}) {
    return (
        <Card className="flex flex-col gap-4">
            <h2 className="font-mono text-bb-xs uppercase tracking-[0.12em] text-bb-faint">
                {title}
            </h2>

            {failed ? (
                <ErrorState detail="The board didn't load. Refresh the page to try again." />
            ) : rows.length === 0 ? (
                <EmptyState
                    title="No one on the board yet"
                    hint="Answer a question correctly to claim first place."
                />
            ) : (
                <ol className="flex flex-col gap-1">
                    {rows.map((row) => (
                        <li
                            key={row.userId}
                            className="flex items-center gap-3 rounded-bb-md px-3 py-2.5 transition-colors hover:bg-bb-raised"
                        >
                            <RankBadge rank={row.rank} />
                            <Avatar name={row.username} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-bb-sm font-medium text-bb-text">
                                {row.username}
                            </span>
                            <span className="shrink-0 text-right font-mono text-bb-sm font-medium text-bb-text tabular">
                                {metric === 'score'
                                    ? formatScore(row.totalScore)
                                    : (row.maxStreak ?? 0)}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    );
}

export default async function LeaderboardPage() {
    const { scores, streaks, failed } = await getBoards();

    return (
        <div className="min-h-screen">
            <AppHeader />

            <main className="mx-auto max-w-4xl px-4 py-10">
                <header className="mb-8 flex flex-col gap-2">
                    <h1 className="font-display text-bb-3xl font-bold tracking-tight text-bb-text">
                        Leaderboard
                    </h1>
                    <p className="text-bb-sm text-bb-muted">
                        The top ten by score and by best streak.{' '}
                        <Link href="/" className="text-bb-accent hover:underline">
                            Play a round
                        </Link>{' '}
                        to get on it.
                    </p>
                </header>

                <div className="grid gap-6 md:grid-cols-2">
                    <Board title="Top scores" rows={scores} metric="score" failed={failed} />
                    <Board title="Top streaks" rows={streaks} metric="streak" failed={failed} />
                </div>
            </main>
        </div>
    );
}
