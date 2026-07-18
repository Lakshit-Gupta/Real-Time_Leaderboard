"use client";

import { useId, useMemo } from 'react';
import { levelColor } from '@/lib/format';
import type { TracePoint } from '@/hooks/useQuiz';

const VIEW_W = 320;
const VIEW_H = 72;
const PAD = 6;
const MAX_POINTS = 24;

// Confidence thresholds from the adaptive engine: >=7 levels up, <=3 levels down.
const CONF_UP = 7;
const CONF_DOWN = 3;

/**
 * The signature panel: it makes the hidden adaptive engine visible.
 * The line is your difficulty over this session; the meter is the confidence
 * score that decides when the next level change fires.
 */
export function AbilityTrace({
    trace,
    difficulty,
    confidence,
}: {
    trace: TracePoint[];
    difficulty: number;
    /** Undefined until the engine reports it — never guessed. */
    confidence?: number;
}) {
    const gradientId = useId();

    const { linePath, areaPath, lastPoint } = useMemo(() => {
        const points = trace.slice(-MAX_POINTS);
        if (points.length === 0) return { linePath: '', areaPath: '', lastPoint: null };

        const stepX =
            points.length > 1 ? (VIEW_W - PAD * 2) / (points.length - 1) : 0;
        // Difficulty 1..10 -> bottom..top
        const toY = (d: number) =>
            VIEW_H - PAD - ((d - 1) / 9) * (VIEW_H - PAD * 2);

        const coords = points.map((p, i) => ({
            x: PAD + i * stepX,
            y: toY(p.difficulty),
        }));

        // Stepped: difficulty holds until an answer changes it.
        let line = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 1; i < coords.length; i++) {
            line += ` L ${coords[i].x} ${coords[i - 1].y} L ${coords[i].x} ${coords[i].y}`;
        }

        const last = coords[coords.length - 1];
        const area = `${line} L ${last.x} ${VIEW_H - PAD} L ${coords[0].x} ${VIEW_H - PAD} Z`;

        return { linePath: line, areaPath: area, lastPoint: last };
    }, [trace]);

    const color = levelColor(difficulty);
    const hasConfidence = typeof confidence === 'number';
    const confPct = hasConfidence ? Math.max(0, Math.min(100, (confidence / 10) * 100)) : 0;

    return (
        <section className="bb-card flex flex-col gap-4" aria-label="Ability trace">
            <header className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                    <h2 className="font-mono text-bb-xs uppercase tracking-[0.12em] text-bb-faint">
                        Ability trace
                    </h2>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-bb-xs text-bb-faint">LVL</span>
                    <span
                        className="font-display text-bb-2xl font-bold tabular leading-none"
                        style={{ color }}
                    >
                        {difficulty}
                    </span>
                    <span className="font-mono text-bb-xs text-bb-faint">/10</span>
                </div>
            </header>

            {trace.length === 0 ? (
                <p className="py-6 text-center text-bb-xs text-bb-muted">
                    Answer a few questions and your difficulty will chart itself here.
                </p>
            ) : (
                <svg
                    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                    className="h-[72px] w-full"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`Difficulty over the last ${Math.min(trace.length, MAX_POINTS)} answers. Now at level ${difficulty} of 10.`}
                >
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    <path d={areaPath} fill={`url(#${gradientId})`} />
                    <path
                        d={linePath}
                        fill="none"
                        stroke={color}
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                    />
                    {lastPoint && (
                        <circle cx={lastPoint.x} cy={lastPoint.y} r="2.5" fill={color} />
                    )}
                </svg>
            )}

            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                    <span className="font-mono text-bb-xs uppercase tracking-[0.12em] text-bb-faint">
                        Confidence
                    </span>
                    <span className="font-mono text-bb-xs text-bb-muted tabular">
                        {hasConfidence ? `${confidence}/10` : '—'}
                    </span>
                </div>

                {/* The band between the two thresholds is where difficulty holds steady. */}
                <div
                    role="meter"
                    aria-valuenow={confidence}
                    aria-valuemin={0}
                    aria-valuemax={10}
                    aria-valuetext={hasConfidence ? undefined : 'Unknown'}
                    aria-label="Confidence toward the next level change"
                    className="relative h-1.5 w-full overflow-hidden rounded-full bg-bb-raised"
                >
                    <div
                        aria-hidden="true"
                        className="absolute inset-y-0 bg-bb-border"
                        style={{
                            left: `${CONF_DOWN * 10}%`,
                            width: `${(CONF_UP - CONF_DOWN) * 10}%`,
                        }}
                    />
                    <div
                        aria-hidden="true"
                        className="absolute inset-y-0 rounded-full transition-[width] duration-500 ease-out"
                        style={{ width: `${confPct}%`, backgroundColor: color }}
                    />
                </div>

                <p className="font-mono text-[0.625rem] text-bb-faint">
                    {!hasConfidence
                        ? 'Answer a question to read your confidence'
                        : confidence >= CONF_UP
                          ? 'One more correct answer levels you up'
                          : confidence <= CONF_DOWN
                            ? 'One more miss drops a level'
                            : `Holding steady between ${CONF_DOWN} and ${CONF_UP}`}
                </p>
            </div>
        </section>
    );
}
