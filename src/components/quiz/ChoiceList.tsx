"use client";

import { useEffect, useRef } from 'react';
import type { Feedback } from '@/hooks/useQuiz';

const LABELS = ['A', 'B', 'C', 'D'];

/**
 * A single-choice control is a radiogroup, not a listbox — the previous markup
 * used role="option" on <button>s, which is invalid and gives screen readers
 * no arrow-key model. Roving tabindex keeps the group one tab stop.
 */
export function ChoiceList({
    choices,
    selectedIndex,
    feedback,
    onSelect,
}: {
    choices: string[];
    selectedIndex: number | null;
    feedback: Feedback | null;
    onSelect: (index: number) => void;
}) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);

    // A/B/C/D pick an answer without reaching for the mouse.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (feedback || e.metaKey || e.ctrlKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

            const index = LABELS.indexOf(e.key.toUpperCase());
            if (index !== -1 && index < choices.length) {
                onSelect(index);
                refs.current[index]?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [choices.length, feedback, onSelect]);

    const onKeyDown = (e: React.KeyboardEvent, index: number) => {
        const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
        const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
        if (!forward && !back) return;

        e.preventDefault();
        const next = forward
            ? (index + 1) % choices.length
            : (index - 1 + choices.length) % choices.length;
        onSelect(next);
        refs.current[next]?.focus();
    };

    return (
        <div role="radiogroup" aria-label="Answer choices" className="flex flex-col gap-2">
            {choices.map((choice, index) => {
                const isSelected = selectedIndex === index;
                const isCorrect = feedback?.correctIndex === index;
                const isWrongPick = !!feedback && isSelected && !feedback.correct;

                let tone = 'border-bb-border bg-bb-raised text-bb-text hover:border-bb-accent';
                if (feedback) {
                    if (isCorrect) tone = 'bb-success-subtle text-bb-success';
                    else if (isWrongPick) tone = 'bb-error-subtle text-bb-error';
                    else tone = 'border-bb-border bg-bb-raised text-bb-faint opacity-60';
                } else if (isSelected) {
                    tone = 'bb-accent-subtle text-bb-text';
                }

                return (
                    <button
                        key={index}
                        ref={(el) => {
                            refs.current[index] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        // Roving tabindex: the group is a single tab stop.
                        tabIndex={isSelected || (selectedIndex === null && index === 0) ? 0 : -1}
                        disabled={!!feedback}
                        onClick={() => onSelect(index)}
                        onKeyDown={(e) => onKeyDown(e, index)}
                        className={`flex w-full items-center gap-3 rounded-bb-md border px-4 py-3 text-left transition-colors disabled:cursor-default ${tone}`}
                    >
                        <span
                            aria-hidden="true"
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[0.375rem] border font-mono text-bb-xs ${
                                isSelected && !feedback
                                    ? 'border-bb-accent text-bb-accent'
                                    : 'border-bb-border text-bb-faint'
                            }`}
                        >
                            {LABELS[index]}
                        </span>
                        <span className="text-bb-sm font-medium">{choice}</span>
                    </button>
                );
            })}
        </div>
    );
}
