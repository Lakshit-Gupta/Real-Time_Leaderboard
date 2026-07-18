"use client";
import { InputHTMLAttributes, forwardRef, useId } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ label, error, className = '', id, ...props }, ref) => {
        const generatedId = useId();
        const inputId = id ?? generatedId;
        const errorId = `${inputId}-error`;

        return (
            <div className="flex flex-col gap-2 w-full">
                {label && (
                    <label htmlFor={inputId} className="text-bb-sm font-medium text-bb-muted">
                        {label}
                    </label>
                )}
                <input
                    ref={ref}
                    id={inputId}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    className={`bb-input ${error ? 'border-bb-error' : ''} ${className}`}
                    {...props}
                />
                {error && (
                    <span id={errorId} role="alert" className="text-bb-xs text-bb-error">
                        {error}
                    </span>
                )}
            </div>
        );
    }
);
Input.displayName = 'Input';
