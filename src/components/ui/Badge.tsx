import { HTMLAttributes } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: 'default' | 'success' | 'error' | 'warning' | 'accent';
}

const variantClasses = {
    default: 'bg-bb-raised text-bb-muted border border-bb-border',
    success: 'bb-success-subtle text-bb-success border',
    error: 'bb-error-subtle text-bb-error border',
    warning: 'bb-warning-subtle text-bb-warning border',
    accent: 'bb-accent-subtle text-bb-accent border',
};

export function Badge({ children, variant = 'default', className = '', ...props }: BadgeProps) {
    return (
        <span className={`bb-badge ${variantClasses[variant]} ${className}`} {...props}>
            {children}
        </span>
    );
}
