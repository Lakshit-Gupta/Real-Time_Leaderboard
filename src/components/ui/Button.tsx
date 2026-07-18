"use client";
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
}

// Shared by every variant so padding, radius and disabled state are defined once.
const base =
    'inline-flex items-center justify-center gap-2 rounded-bb-md font-medium transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed';

const variantClasses = {
    primary: 'bb-btn-primary',
    secondary: 'bg-bb-raised border border-bb-border text-bb-text hover:border-bb-accent',
    ghost: 'bg-transparent text-bb-muted hover:text-bb-text hover:bg-bb-raised',
    danger: 'bg-bb-error text-white hover:opacity-90',
};

const sizeClasses = {
    sm: 'text-bb-sm px-3 py-1.5',
    md: 'text-bb-sm px-4 py-2.5',
    lg: 'text-bb-base px-6 py-3',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'primary', size = 'md', loading = false, children, className = '', disabled, ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={`${base} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
                disabled={disabled || loading}
                aria-busy={loading || undefined}
                {...props}
            >
                {loading && (
                    <span
                        aria-hidden="true"
                        className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"
                    />
                )}
                {children}
            </button>
        );
    }
);
Button.displayName = 'Button';
