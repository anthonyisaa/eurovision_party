'use client';

// /reveal — the 10-step animated reveal.
//
// Form factor:
//   - Mobile (window.innerWidth < 768 and no ?tv=1): we render a tiny
//     "look at the TV" companion card with the guest's own score so the
//     phone doesn't try to imitate the TV's animation budget.
//   - Desktop / TV / ?tv=1: full-bleed RevealStage.
//
// The host advances steps from /admin; this page is read-only and reacts
// to `parties.reveal_step` via useParty(). When step is 0 the stage shows a
// "standing by" idle card so the screen is never blank.

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useParty } from '@/lib/use-party';
import { getPartyId } from '@/lib/party-id';
import { getGuestIdClient } from '@/lib/guest-id';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { tallyRoomResults, type Vote } from '@/lib/scoring';
import { RevealStage } from '@/components/reveal/RevealStage';
import type { Database } from '@eurojury/db/types';

type Guest = Database['public']['Tables']['guests']['Row'];

interface ActualResultEntry {
  position: number;
  country_code: string;
}

// useSearchParams() requires a Suspense boundary at build time (Next.js 15+
// pre-renders the page during build and bails on CSR otherwise). Wrap the
// real component in a thin Suspense shell so the build smoke-tests pass.
export default function RevealPage() {
  return (
    <Suspense fallback={<RevealLoadingFallback />}>
      <RevealPageInner />
    </Suspense>
  );
}

function RevealLoadingFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-eurorose-950 p-6 text-center">
      <p className="text-sm text-muted-foreground">Loading reveal stage…</p>
    </main>
  );
}

function RevealPageInner() {
  const partyId = useMemo(() => {
    try {
      return getPartyId();
    } catch {
      return '';
    }
  }, []);
  const search = useSearchParams();
  const forceTv = search?.get('tv') === '1';

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const apply = () => setIsMobile(window.innerWidth < 768);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const { party } = useParty(partyId);

  if (!partyId) {
    return (
      <main className="mx-auto w-full max-w-md p-6 text-center">
        <p className="text-sm text-destructive">
          NEXT_PUBLIC_PARTY_ID is not configured.
        </p>
      </main>
    );
  }

  const revealStep = party?.reveal_step ?? 0;
  const actualResults = (party?.actual_results ?? null) as
    | ActualResultEntry[]
    | null;

  // Server-rendered fallback before client mount — we always emit the
  // stage shell so curl-style smoke tests can see the page exists.
  const showTvSurface = forceTv || !isMobile;

  if (!showTvSurface) {
    return (
      <PhoneCompanion partyId={partyId} revealStep={revealStep} />
    );
  }

  return (
    <RevealStage
      partyId={partyId}
      revealStep={revealStep}
      actualResults={actualResults}
    />
  );
}

// ---------------------------------------------------------------------------
// Phone companion — tiny card. Shows the guest's current rank in the room
// once revealStep is >= 2 (rankings only become meaningful then).
// ---------------------------------------------------------------------------

function PhoneCompanion({
  partyId,
  revealStep,
}: {
  partyId: string;
  revealStep: number;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [me, setMe] = useState<Guest | null>(null);
  const [myTopCountry, setMyTopCountry] = useState<{
    code: string;
    points: number;
    roomRank: number;
  } | null>(null);

  useEffect(() => {
    if (!partyId) return;
    const gid = getGuestIdClient();
    if (!gid) return;
    let cancelled = false;
    (async () => {
      const [guestRes, votesRes, myVotesRes] = await Promise.all([
        supabase.from('guests').select('*').eq('id', gid).maybeSingle(),
        supabase
          .from('votes')
          .select('*')
          .in(
            'guest_id',
            (
              await supabase.from('guests').select('id').eq('party_id', partyId)
            ).data?.map((g) => g.id) ?? [],
          ),
        supabase.from('votes').select('*').eq('guest_id', gid),
      ]);
      if (cancelled) return;
      setMe((guestRes.data as Guest | null) ?? null);
      const allVotes = (votesRes.data ?? []) as Vote[];
      const ranking = tallyRoomResults(allVotes);
      const myVotes = (myVotesRes.data ?? []) as Vote[];
      const myTop = [...myVotes].sort((a, b) => b.points - a.points)[0];
      if (myTop) {
        const rank =
          ranking.findIndex((r) => r.country === myTop.country_code) + 1;
        setMyTopCountry({
          code: myTop.country_code,
          points: myTop.points,
          roomRank: rank > 0 ? rank : 0,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run whenever the reveal step ticks so the room rank stays fresh
    // across step boundaries.
  }, [supabase, partyId, revealStep]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-eurorose-950 p-6 text-center">
      <Card className="w-full max-w-sm border-eurogold-500/40 bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle>Look at the TV 👆</CardTitle>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Reveal step {revealStep} / 10
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-center">
          {revealStep === 0 ? (
            <p className="text-sm text-muted-foreground">
              The reveal hasn&apos;t started yet. Hang tight — the host is
              about to fire it up.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The big animations are happening on the TV. This screen just
              shows your tally.
            </p>
          )}

          {me && (
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                You
              </p>
              <p className="text-xl font-bold">{me.display_name}</p>
            </div>
          )}

          {myTopCountry ? (
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Your top vote
              </p>
              <p className="text-3xl font-black">{myTopCountry.code}</p>
              <p className="text-xs text-muted-foreground">
                {myTopCountry.points} pts — currently #{myTopCountry.roomRank} in room
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No vote on record for you. Enjoy the show on TV.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
