"use client";

import { useLayoutEffect, useRef, useState } from 'react';
import type { LeaderboardEntry } from '@/lib/api';

const FLIP_MS = 420;

/**
 * FLIP: React re-orders the rows, then each one is inverted back to its previous
 * position and transitioned to the new one — a rank change reads as movement
 * instead of a jump.
 *
 * Rows are found by `data-user-id` rather than a ref map, so there are no
 * per-row ref callbacks churning on every render.
 */
export function useRankAnimation(entries: LeaderboardEntry[]) {
    const listRef = useRef<HTMLOListElement>(null);
    const prevTops = useRef(new Map<string, number>());

    // Derive deltas during render via the "adjust state on prop change" pattern,
    // so nothing reads a ref while rendering.
    const [seen, setSeen] = useState(entries);
    const [tracked, setTracked] = useState<{
        ranks: Map<string, number>;
        deltas: Map<string, number>;
    }>(() => ({ ranks: new Map(), deltas: new Map() }));

    if (entries !== seen) {
        setSeen(entries);
        const deltas = new Map<string, number>();
        entries.forEach((entry) => {
            const before = tracked.ranks.get(entry.userId);
            // Positive = climbed.
            if (before !== undefined && before !== entry.rank) {
                deltas.set(entry.userId, before - entry.rank);
            }
        });
        setTracked({
            ranks: new Map(entries.map((e) => [e.userId, e.rank])),
            deltas,
        });
    }

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;

        const rows = Array.from(
            list.querySelectorAll<HTMLElement>('[data-user-id]')
        );

        // Measure everything before touching anything.
        const nextTops = new Map<string, number>();
        rows.forEach((el) => {
            const id = el.dataset.userId;
            if (id) nextTops.set(id, el.getBoundingClientRect().top);
        });

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduced) {
            rows.forEach((el) => {
                const id = el.dataset.userId;
                if (!id) return;
                const previous = prevTops.current.get(id);
                const next = nextTops.get(id);
                if (previous === undefined || next === undefined) return;

                const shift = previous - next;
                if (Math.abs(shift) < 1) return;

                el.style.transition = 'none';
                el.style.transform = `translateY(${shift}px)`;
                requestAnimationFrame(() => {
                    el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
                    el.style.transform = '';
                });
            });
        }

        prevTops.current = nextTops;
    }, [entries]);

    return { listRef, deltas: tracked.deltas };
}
