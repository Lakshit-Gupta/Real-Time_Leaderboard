"use client";

import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { BoltMark } from '@/components/layout/BoltMark';

/** The ten difficulty levels, in the colours the app uses everywhere else.
 *  It shows what the product does instead of claiming it in marketing copy. */
function LevelRamp() {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-1" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                    <span
                        key={i}
                        className="h-1.5 flex-1 rounded-full"
                        style={{ backgroundColor: `var(--bb-level-${i + 1})` }}
                    />
                ))}
            </div>
            <div className="flex justify-between font-mono text-[0.625rem] text-bb-faint">
                <span>LVL 1</span>
                <span>LVL 10</span>
            </div>
        </div>
    );
}

export function LoginScreen({
    onSignIn,
    isSigningIn,
    error,
}: {
    onSignIn: (username: string) => void;
    isSigningIn: boolean;
    error: string | null;
}) {
    const [username, setUsername] = useState('');
    const canSubmit = username.trim().length > 0 && !isSigningIn;

    return (
        <main className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-sm">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (canSubmit) onSignIn(username);
                    }}
                    className="bb-card flex flex-col gap-8"
                >
                    <header className="flex flex-col gap-3">
                        <BoltMark className="h-6 w-6 text-bb-accent" />
                        <h1 className="font-display text-bb-3xl font-bold leading-none tracking-tight text-bb-text">
                            BrainBolt
                        </h1>
                        <p className="text-bb-sm leading-relaxed text-bb-muted text-pretty">
                            A quiz that reads how you&apos;re doing and moves the difficulty to
                            match. Hold a streak to multiply your score.
                        </p>
                    </header>

                    <div className="flex flex-col gap-4">
                        <Input
                            label="Pick a username"
                            placeholder="ada_lovelace"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            error={error ?? undefined}
                            autoFocus
                            autoComplete="username"
                            disabled={isSigningIn}
                            maxLength={20}
                        />
                        <Button
                            type="submit"
                            size="lg"
                            disabled={!canSubmit}
                            loading={isSigningIn}
                            className="w-full"
                        >
                            Start playing
                        </Button>
                    </div>

                    <LevelRamp />
                </form>
            </div>
        </main>
    );
}
