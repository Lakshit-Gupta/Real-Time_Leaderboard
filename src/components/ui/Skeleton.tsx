export function Skeleton({ className = '' }: { className?: string }) {
    return (
        <div aria-hidden="true" className={`animate-pulse bg-bb-raised rounded-bb-md ${className}`} />
    );
}

// Wraps a group of skeletons so assistive tech announces the wait once, not per bar.
export function SkeletonGroup({
    children,
    label = 'Loading',
    className = '',
}: {
    children: React.ReactNode;
    label?: string;
    className?: string;
}) {
    return (
        <div role="status" aria-busy="true" aria-label={label} className={className}>
            {children}
        </div>
    );
}

export function SkeletonCard() {
    return (
        <SkeletonGroup label="Loading question" className="bb-card space-y-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
            <div className="grid gap-3 mt-6">
                {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                ))}
            </div>
        </SkeletonGroup>
    );
}
