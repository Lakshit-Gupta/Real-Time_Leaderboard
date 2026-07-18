export function Meter({
    value,
    max = 10,
    color,
    label,
    className = '',
}: {
    value: number;
    max?: number;
    color?: string;
    label?: string;
    className?: string;
}) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));

    return (
        <div
            role="meter"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-label={label}
            className={`h-1 w-full overflow-hidden rounded-full bg-bb-raised ${className}`}
        >
            <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-out"
                style={{ width: `${pct}%`, backgroundColor: color ?? 'var(--bb-accent)' }}
            />
        </div>
    );
}
