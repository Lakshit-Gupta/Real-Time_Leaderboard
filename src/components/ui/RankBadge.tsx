// Only the podium earns a medal colour; every other rank stays quiet so the
// top three read instantly. The tokens carry the per-theme values.
const MEDALS: Record<number, string> = {
    1: 'var(--bb-medal-gold)',
    2: 'var(--bb-medal-silver)',
    3: 'var(--bb-medal-bronze)',
};

export function RankBadge({ rank }: { rank: number }) {
    const medal = MEDALS[rank];

    if (!medal) {
        return (
            <span className="w-7 h-7 inline-flex shrink-0 items-center justify-center font-mono text-bb-xs text-bb-faint tabular">
                {rank}
            </span>
        );
    }

    return (
        <span
            className="bb-medal w-7 h-7 inline-flex shrink-0 items-center justify-center rounded-full font-mono text-bb-xs font-semibold tabular"
            style={{ '--bb-medal': medal } as React.CSSProperties}
        >
            {rank}
        </span>
    );
}
