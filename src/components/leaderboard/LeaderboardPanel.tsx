"use client";

import { memo, useState } from 'react';
import { Card, EmptyState, ErrorState, Skeleton, SkeletonGroup } from '@/components/ui';
import { useLeaderboard, type Board } from '@/hooks/useLeaderboard';
import { LeaderboardRow } from './LeaderboardRow';
import { LiveIndicator } from './LiveIndicator';
import { useRankAnimation } from './useRankAnimation';

const TABS: { id: Board; label: string }[] = [
    { id: 'score', label: 'Score' },
    { id: 'streak', label: 'Streak' },
];

function LeaderboardPanel({
    userId,
    token,
    onUnauthorized,
}: {
    userId: string;
    token: string;
    onUnauthorized?: () => void;
}) {
    const [board, setBoard] = useState<Board>('score');
    const { entries, currentUser, updatedAt, error, isInitialLoad } = useLeaderboard(
        token,
        board,
        onUnauthorized
    );
    const { listRef, deltas } = useRankAnimation(entries);

    return (
        <Card className="flex flex-col gap-4">
            <header className="flex items-center justify-between gap-4">
                <div
                    role="tablist"
                    aria-label="Leaderboard type"
                    className="flex gap-1 rounded-bb-md bg-bb-raised p-1"
                >
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={board === tab.id}
                            onClick={() => setBoard(tab.id)}
                            className={`rounded-[0.375rem] px-3 py-1 text-bb-xs font-medium transition-colors cursor-pointer ${
                                board === tab.id
                                    ? 'bg-bb-surface text-bb-text shadow-bb-card'
                                    : 'text-bb-muted hover:text-bb-text'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <LiveIndicator updatedAt={updatedAt} stale={!!error} />
            </header>

            {/* Errors replace the list only when there's nothing to show; a failed
                poll over existing data keeps the last good board visible. */}
            {error && entries.length === 0 ? (
                <ErrorState detail={error} />
            ) : isInitialLoad ? (
                <SkeletonGroup label="Loading leaderboard" className="flex flex-col gap-2">
                    {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-11" />
                    ))}
                </SkeletonGroup>
            ) : entries.length === 0 ? (
                <EmptyState
                    title="No one on the board yet"
                    hint="Answer a question correctly to claim first place."
                />
            ) : (
                <ol ref={listRef} className="flex flex-col gap-1">
                    {entries.map((entry) => (
                        <LeaderboardRow
                            key={entry.userId}
                            entry={entry}
                            board={board}
                            isCurrentUser={entry.userId === userId}
                            delta={deltas.get(entry.userId)}
                        />
                    ))}
                </ol>
            )}

            {/* Pinned when the player is outside the top 10 — they always see themselves. */}
            {currentUser && (
                <div className="border-t border-bb-border pt-3">
                    <ol>
                        <LeaderboardRow
                            entry={currentUser}
                            board={board}
                            isCurrentUser
                            delta={deltas.get(currentUser.userId)}
                        />
                    </ol>
                </div>
            )}
        </Card>
    );
}

export default memo(LeaderboardPanel);
