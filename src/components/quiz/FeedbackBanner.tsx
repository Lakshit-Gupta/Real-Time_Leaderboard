"use client";

import { formatScore } from '@/lib/format';
import type { Feedback } from '@/hooks/useQuiz';

export function FeedbackBanner({ feedback }: { feedback: Feedback }) {
    const { correct, scoreDelta } = feedback;

    return (
        <div
            role="status"
            aria-live="polite"
            className={`flex items-center justify-between rounded-bb-md border px-4 py-3 ${
                correct ? 'bb-success-subtle' : 'bb-error-subtle'
            }`}
        >
            <p
                className="text-bb-sm font-medium"
                style={{ color: correct ? 'var(--bb-success)' : 'var(--bb-error)' }}
            >
                {correct ? 'Correct' : 'Not this time — the right answer is highlighted'}
            </p>
            {correct && (
                <p className="font-mono text-bb-sm font-semibold text-bb-success tabular">
                    +{formatScore(scoreDelta)}
                </p>
            )}
        </div>
    );
}
