"use client";

import { memo } from 'react';
import { formatScore, streakMultiplier } from '@/lib/format';

function StatTile({
    label,
    value,
    accent,
    hint,
}: {
    label: string;
    value: string;
    accent?: string;
    hint?: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="font-mono text-bb-xs uppercase tracking-[0.12em] text-bb-faint">
                {label}
            </span>
            <span className="flex items-baseline gap-1.5">
                <span
                    className="font-display text-bb-2xl font-bold leading-none tabular"
                    style={accent ? { color: accent } : undefined}
                >
                    {value}
                </span>
                {hint && (
                    <span className="font-mono text-bb-xs text-bb-muted">{hint}</span>
                )}
            </span>
        </div>
    );
}

function StatsBar({
    score,
    streak,
    maxStreak,
}: {
    score: number;
    streak: number;
    maxStreak: number;
}) {
    const multiplier = streakMultiplier(streak);

    return (
        <div className="bb-card grid grid-cols-3 gap-6">
            <StatTile label="Score" value={formatScore(score)} />
            <StatTile
                label="Streak"
                value={String(streak)}
                accent={streak > 0 ? 'var(--bb-accent)' : undefined}
                hint={streak > 0 ? `${multiplier.toFixed(2)}×` : undefined}
            />
            <StatTile label="Best" value={String(maxStreak)} />
        </div>
    );
}

export default memo(StatsBar);
