import { Button } from './Button';

/**
 * Empty and error are different situations and must never look alike:
 * empty invites an action, error explains what broke and offers a way out.
 */

export function EmptyState({
    title,
    hint,
    className = '',
}: {
    title: string;
    hint?: string;
    className?: string;
}) {
    return (
        <div className={`flex flex-col items-center justify-center gap-2 py-10 text-center ${className}`}>
            <p className="text-bb-sm font-medium text-bb-text">{title}</p>
            {hint && <p className="text-bb-xs text-bb-muted max-w-[32ch]">{hint}</p>}
        </div>
    );
}

export function ErrorState({
    title = "That didn't load",
    detail,
    onRetry,
    className = '',
}: {
    title?: string;
    detail?: string;
    onRetry?: () => void;
    className?: string;
}) {
    return (
        <div
            role="alert"
            className={`flex flex-col items-center justify-center gap-3 py-10 text-center ${className}`}
        >
            <div className="flex flex-col gap-1">
                <p className="text-bb-sm font-medium text-bb-error">{title}</p>
                {detail && <p className="text-bb-xs text-bb-muted max-w-[36ch]">{detail}</p>}
            </div>
            {onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                    Try again
                </Button>
            )}
        </div>
    );
}
