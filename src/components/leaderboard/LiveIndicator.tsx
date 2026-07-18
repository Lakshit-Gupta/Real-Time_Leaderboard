"use client";

import { useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/format';

/**
 * Shows the board is live and how stale it is. The dot stops pulsing when the
 * feed errors, so "live" is never a lie.
 */
export function LiveIndicator({
    updatedAt,
    stale = false,
}: {
    updatedAt: number | null;
    stale?: boolean;
}) {
    const [, tick] = useState(0);

    // Re-render each second so the relative timestamp stays honest.
    useEffect(() => {
        const id = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, []);

    return (
        <span className="flex items-center gap-1.5 font-mono text-[0.625rem] text-bb-faint">
            <span className="relative flex h-1.5 w-1.5">
                {!stale && (
                    <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                        style={{ backgroundColor: 'var(--bb-success)' }}
                    />
                )}
                <span
                    className="relative inline-flex h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: stale ? 'var(--bb-error)' : 'var(--bb-success)' }}
                />
            </span>
            {updatedAt ? formatRelativeTime(updatedAt) : '—'}
        </span>
    );
}
