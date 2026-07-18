"use client";

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Avatar, Button } from '@/components/ui';
import { BoltMark } from './BoltMark';

const ThemeToggle = dynamic(() => import('./ThemeToggle'), {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
});

export function AppHeader({
    username,
    onSignOut,
}: {
    username?: string;
    onSignOut?: () => void;
}) {
    return (
        <header className="bb-glass sticky top-0 z-10 border-b">
            <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
                <Link
                    href="/"
                    className="flex items-center gap-2 rounded-bb-sm text-bb-text"
                    aria-label="BrainBolt home"
                >
                    <BoltMark className="h-4 w-4 text-bb-accent" />
                    <span className="font-display text-bb-base font-bold tracking-tight">
                        BrainBolt
                    </span>
                </Link>

                <div className="flex items-center gap-2">
                    <Link
                        href="/leaderboard"
                        className="rounded-bb-md px-3 py-1.5 text-bb-sm text-bb-muted transition-colors hover:bg-bb-raised hover:text-bb-text"
                    >
                        Leaderboard
                    </Link>

                    {username && (
                        <span className="flex items-center gap-2 pl-1">
                            <Avatar name={username} size="sm" />
                            <span className="hidden text-bb-sm text-bb-muted sm:inline">
                                {username}
                            </span>
                        </span>
                    )}

                    <ThemeToggle />

                    {onSignOut && (
                        <Button variant="ghost" size="sm" onClick={onSignOut}>
                            Sign out
                        </Button>
                    )}
                </div>
            </div>
        </header>
    );
}
