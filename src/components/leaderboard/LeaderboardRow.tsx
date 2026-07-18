"use client";

import { memo } from 'react';
import { Avatar, RankBadge } from '@/components/ui';
import { formatScore } from '@/lib/format';
import type { LeaderboardEntry } from '@/lib/api';
import type { Board } from '@/hooks/useLeaderboard';

interface Props {
    entry: LeaderboardEntry;
    board: Board;
    isCurrentUser: boolean;
    /** Positive = climbed, negative = dropped, 0/undefined = held. */
    delta?: number;
}

function RankDelta({ delta }: { delta: number }) {
    const climbed = delta > 0;
    return (
        <span
            className="font-mono text-[0.625rem] tabular"
            style={{ color: climbed ? 'var(--bb-success)' : 'var(--bb-error)' }}
            title={`${climbed ? 'Up' : 'Down'} ${Math.abs(delta)} since last update`}
        >
            {climbed ? '▲' : '▼'}
            {Math.abs(delta)}
        </span>
    );
}

export const LeaderboardRow = memo(function LeaderboardRow({
    entry,
    board,
    isCurrentUser,
    delta,
}: Props) {
    const value = board === 'score' ? entry.totalScore : (entry.maxStreak ?? 0);

    return (
        <li
            // The FLIP pass finds rows by this attribute.
            data-user-id={entry.userId}
            className={`flex items-center gap-3 rounded-bb-md px-3 py-2.5 transition-colors ${
                isCurrentUser ? 'bb-accent-subtle border' : 'border border-transparent hover:bg-bb-raised'
            }`}
        >
                <RankBadge rank={entry.rank} />

                <Avatar name={entry.username} size="sm" />

                <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-bb-sm font-medium text-bb-text">
                        {entry.username}
                    </span>
                    {isCurrentUser && (
                        <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-wider text-bb-accent">
                            you
                        </span>
                    )}
                </span>

                {delta ? <RankDelta delta={delta} /> : null}

                <span className="shrink-0 text-right font-mono text-bb-sm font-medium text-bb-text tabular">
                    {board === 'score' ? formatScore(value) : value}
                </span>
        </li>
    );
});
