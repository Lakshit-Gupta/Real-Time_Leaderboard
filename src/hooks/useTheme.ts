"use client";

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'bb-theme';

/**
 * The theme lives on <html>, applied by the inline script in layout.tsx before
 * first paint. That makes it external state, so it's read with
 * useSyncExternalStore rather than mirrored into an effect — the toggle icon is
 * correct on the first frame instead of assuming dark and correcting after.
 */
let listeners: (() => void)[] = [];

function subscribe(onChange: () => void) {
    listeners.push(onChange);
    return () => {
        listeners = listeners.filter((l) => l !== onChange);
    };
}

function getSnapshot() {
    return document.documentElement.classList.contains('dark');
}

// The server has no DOM; it renders the dark default the script also assumes.
function getServerSnapshot() {
    return true;
}

export function useTheme() {
    const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const toggle = useCallback(() => {
        const next = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', next);
        try {
            localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
        } catch {
            // Preference just won't persist.
        }
        listeners.forEach((l) => l());
    }, []);

    return { isDark, toggle };
}
