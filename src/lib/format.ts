// Score is a float server-side (difficulty × multiplier × accuracy).
// It is rounded once, here, so every surface shows the same number.
export function formatScore(value: number): string {
    return Math.round(value).toLocaleString();
}

export function formatRelativeTime(from: number, now: number = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - from) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * Difficulty 1–10 mapped onto the cool→bolt ramp. Colour here always encodes
 * difficulty, never decoration, so the same level reads the same everywhere.
 */
export function levelColor(difficulty: number): string {
    const level = Math.max(1, Math.min(10, Math.round(difficulty)));
    return `var(--bb-level-${level})`;
}

export function streakMultiplier(streak: number): number {
    return Math.min(4, 1 + streak * 0.25);
}
