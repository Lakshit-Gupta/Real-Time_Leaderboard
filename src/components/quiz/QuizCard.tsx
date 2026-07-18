"use client";

import { Badge, Button, Card, ErrorState, SkeletonCard } from '@/components/ui';
import { levelColor } from '@/lib/format';
import { ChoiceList } from './ChoiceList';
import { FeedbackBanner } from './FeedbackBanner';
import type { Feedback } from '@/hooks/useQuiz';
import type { Question } from '@/lib/api';

interface Props {
    question: Question | null;
    selectedIndex: number | null;
    feedback: Feedback | null;
    isLoading: boolean;
    isSubmitting: boolean;
    error: string | null;
    onSelect: (index: number) => void;
    onSubmit: () => void;
    onRetry: () => void;
}

export function QuizCard({
    question,
    selectedIndex,
    feedback,
    isLoading,
    isSubmitting,
    error,
    onSelect,
    onSubmit,
    onRetry,
}: Props) {
    if (isLoading) return <SkeletonCard />;

    if (error && !question) {
        return (
            <Card>
                <ErrorState detail={error} onRetry={onRetry} />
            </Card>
        );
    }

    if (!question) {
        return (
            <Card>
                <ErrorState
                    title="No questions left at this level"
                    detail="You've cleared the pool here. Try again to pick up where the difficulty resets."
                    onRetry={onRetry}
                />
            </Card>
        );
    }

    return (
        <Card className="flex flex-col gap-6">
            <header className="flex items-center justify-between gap-4">
                <span className="truncate font-mono text-bb-xs uppercase tracking-[0.12em] text-bb-faint">
                    {question.category}
                </span>
                <Badge
                    variant="default"
                    className="shrink-0 gap-1.5"
                    style={{ color: levelColor(question.difficulty) }}
                >
                    <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: levelColor(question.difficulty) }}
                    />
                    Level {question.difficulty}
                </Badge>
            </header>

            <h1 className="font-display text-bb-xl font-semibold leading-snug text-bb-text text-balance">
                {question.text}
            </h1>

            <ChoiceList
                choices={question.choices}
                selectedIndex={selectedIndex}
                feedback={feedback}
                onSelect={onSelect}
            />

            {feedback ? (
                <FeedbackBanner feedback={feedback} />
            ) : (
                <Button
                    size="lg"
                    onClick={onSubmit}
                    disabled={selectedIndex === null}
                    loading={isSubmitting}
                    className="w-full"
                >
                    Submit answer
                </Button>
            )}

            {/* A transient failure (e.g. a 409 resync) with a question still on screen. */}
            {error && question && (
                <p role="status" className="text-center text-bb-xs text-bb-muted">
                    {error}
                </p>
            )}
        </Card>
    );
}
