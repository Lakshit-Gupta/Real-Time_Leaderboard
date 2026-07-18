import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    elevated?: boolean;
}

// `.bb-card` already carries the base shadow; only the elevated case overrides it.
export function Card({ children, className = '', elevated = false, ...props }: CardProps) {
    return (
        <div
            className={`bb-card ${elevated ? 'shadow-bb-elevated' : ''} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
}
