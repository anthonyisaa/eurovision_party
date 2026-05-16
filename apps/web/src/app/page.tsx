'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { joinParty } from './actions/join';

// Join page — first thing a guest sees. Single text field + single CTA.
// Everything else (country assignment, cookie issuance, idempotency) is
// handled in the joinParty server action.
export default function JoinPage() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Pick a name');
      return;
    }
    startTransition(async () => {
      const res = await joinParty(trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/lobby');
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-4 text-center">
          <div className="flex justify-center">
            <Image
              src="/eurovision-2026-logo.png"
              alt="Eurovision Song Contest 2026"
              width={300}
              height={130}
              priority
              className="brand-mark h-auto w-full max-w-[240px]"
            />
          </div>
          <p className="text-xs uppercase tracking-[0.3em] text-eurorose-400">
            Eurojury · Vienna 2026
          </p>
          <p className="text-sm text-muted-foreground">
            You&apos;ll be assigned 2 random countries to champion. Try not to
            embarrass them.
          </p>
        </div>

        <Card className="border-europurp-700/40 bg-card/70 shadow-2xl shadow-europurp-900/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Who are you?</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <Input
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoFocus
                disabled={pending}
                className="h-12 text-base"
              />
              <Button
                type="submit"
                disabled={pending}
                className="h-12 w-full text-base font-semibold"
              >
                {pending ? 'Joining…' : 'Join the jury'}
              </Button>
              {error && (
                <p className="text-center text-sm text-destructive">{error}</p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
