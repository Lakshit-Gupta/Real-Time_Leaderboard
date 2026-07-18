// Identity is derived from the username itself — the API stores no avatar image.
// A curated hue set keeps the board colourful without fighting the amber accent.
const HUES = [28, 190, 265, 340, 165, 220];

function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function initials(name: string): string {
    const parts = name.split(/[\s_.-]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

const sizeClasses = {
    sm: 'w-7 h-7 text-[0.625rem]',
    md: 'w-9 h-9 text-bb-xs',
    lg: 'w-12 h-12 text-bb-sm',
};

export function Avatar({
    name,
    size = 'md',
    className = '',
}: {
    name: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}) {
    const hue = HUES[hashString(name) % HUES.length];

    return (
        <span
            aria-hidden="true"
            className={`bb-avatar ${sizeClasses[size]} ${className} inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none`}
            style={{ '--bb-avatar-hue': hue } as React.CSSProperties}
        >
            {initials(name)}
        </span>
    );
}
