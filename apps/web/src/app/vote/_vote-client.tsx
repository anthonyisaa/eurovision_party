'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { getGuestIdClient } from '@/lib/guest-id';
import { lockVotes } from '../actions/votes';
import { POINTS_POOL } from './points-pool';
import type { Database } from '@eurojury/db/types';

type Country = Database['public']['Tables']['countries']['Row'];
type EventRow = Database['public']['Tables']['event_timeline']['Row'];
type Reaction = Database['public']['Tables']['reactions']['Row'];
type Vote = Database['public']['Tables']['votes']['Row'];
type Guest = Database['public']['Tables']['guests']['Row'];

interface PartyState {
  id: string;
  phase: string;
}

const PARTY_ID = process.env.NEXT_PUBLIC_PARTY_ID!;
const UNRANKED_BUCKET = 'unranked';

// Client implementation of /vote. Exported as default for dynamic import
// from page.tsx (with ssr: false) — dnd-kit's DndContext renders an
// undefined collection during Next's prerender pass, so we keep it off the
// SSR path entirely.
export default function VoteClient() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [me, setMe] = useState<Guest | null>(null);
  const [party, setParty] = useState<PartyState | null>(null);
  const [performances, setPerformances] = useState<EventRow[]>([]);
  const [countriesByCode, setCountriesByCode] = useState<Record<string, Country>>({});
  const [myReactions, setMyReactions] = useState<Record<string, Reaction>>({});
  const [myVotes, setMyVotes] = useState<Vote[]>([]);
  const [allVotes, setAllVotes] = useState<Vote[]>([]);
  const [loaded, setLoaded] = useState(false);
  // ranking maps points value -> country_code (or null for empty slot).
  const [ranking, setRanking] = useState<Record<number, string | null>>(() => {
    const init: Record<number, string | null> = {};
    for (const p of POINTS_POOL) init[p] = null;
    return init;
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Bootstrap
  useEffect(() => {
    const gid = getGuestIdClient();
    setGuestId(gid);
    let cancelled = false;
    (async () => {
      // Sequential awaits — see comment in /lobby for why.
      const partyRes = await supabase
        .from('parties')
        .select('id, phase')
        .eq('id', PARTY_ID)
        .single();
      const timelineRes = await supabase
        .from('event_timeline')
        .select('*')
        .eq('party_id', PARTY_ID)
        .eq('category', 'performance');
      const countriesRes = await supabase.from('countries').select('*');
      const guestsRes = await supabase
        .from('guests')
        .select('*')
        .eq('party_id', PARTY_ID);
      if (cancelled) return;
      if (partyRes.data) setParty(partyRes.data);
      const perfs = (timelineRes.data ?? []).slice().sort((a, b) => {
        const sa = a.song_idx ?? a.start_seconds;
        const sb = b.song_idx ?? b.start_seconds;
        return sa - sb;
      });
      setPerformances(perfs);
      const byCode: Record<string, Country> = {};
      for (const c of countriesRes.data ?? []) byCode[c.code] = c;
      setCountriesByCode(byCode);
      const meRow = (guestsRes.data ?? []).find((g) => g.id === gid) ?? null;
      setMe(meRow);

      if (gid) {
        const reactionsRes = await supabase
          .from('reactions')
          .select('*')
          .eq('guest_id', gid);
        const myVotesRes = await supabase
          .from('votes')
          .select('*')
          .eq('guest_id', gid);
        const reactionMap: Record<string, Reaction> = {};
        for (const r of reactionsRes.data ?? []) {
          reactionMap[r.country_code] = r;
        }
        setMyReactions(reactionMap);
        const mv = myVotesRes.data ?? [];
        setMyVotes(mv);
        if (mv.length > 0) {
          const r: Record<number, string | null> = {};
          for (const p of POINTS_POOL) r[p] = null;
          for (const v of mv) r[v.points] = v.country_code;
          setRanking(r);
        }
      }

      // All votes for the lock-count indicator.
      const allVotesRes = await supabase
        .from('votes')
        .select('*')
        .in(
          'guest_id',
          (guestsRes.data ?? []).map((g) => g.id),
        );
      setAllVotes((allVotesRes.data ?? []) as Vote[]);

      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (loaded && !guestId) router.replace('/');
  }, [loaded, guestId, router]);

  // Phones follow the host: leave the ballot when phase moves past voting.
  // Pre-voting phases (lobby/live) → /live. Post-voting (reveal/closed) → /live too,
  // since the TV owns the reveal experience and phones are just along for the ride.
  useEffect(() => {
    if (!party) return;
    if (party.phase === 'lobby') router.replace('/lobby');
    else if (party.phase !== 'voting') router.replace('/live');
  }, [party?.phase, party, router]);

  // Realtime: parties (phase) + votes (lock counter).
  useEffect(() => {
    const chan = supabase
      .channel(`vote:${PARTY_ID}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'parties', filter: `id=eq.${PARTY_ID}` },
        (payload) => {
          const row = payload.new as { id: string; phase: string };
          setParty({ id: row.id, phase: row.phase });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes' },
        () => {
          // Refresh aggregate; light-weight enough for 10 guests.
          supabase
            .from('votes')
            .select('*')
            .then(({ data }) => setAllVotes((data ?? []) as Vote[]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(chan);
    };
  }, [supabase]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 6 } }),
  );

  // Vote-status derived state.
  const myCountries = useMemo(() => {
    if (!me) return new Set<string>();
    return new Set(
      [me.assigned_country_1, me.assigned_country_2].filter(
        (c): c is string => Boolean(c),
      ),
    );
  }, [me]);

  // Eligible candidates = all performance countries minus own.
  const candidateCountries: Country[] = useMemo(() => {
    const list: Country[] = [];
    const seen = new Set<string>();
    for (const p of performances) {
      if (!p.country_code) continue;
      if (myCountries.has(p.country_code)) continue;
      if (seen.has(p.country_code)) continue;
      const c = countriesByCode[p.country_code];
      if (c) {
        list.push(c);
        seen.add(p.country_code);
      }
    }
    return list;
  }, [performances, myCountries, countriesByCode]);

  const rankedCodes = useMemo(
    () => new Set(Object.values(ranking).filter((v): v is string => Boolean(v))),
    [ranking],
  );
  const unrankedCandidates = useMemo(
    () => candidateCountries.filter((c) => !rankedCodes.has(c.code)),
    [candidateCountries, rankedCodes],
  );

  const isLocked = myVotes.length === 10;
  const lockedJurors = useMemo(() => {
    const byGuest = new Map<string, number>();
    for (const v of allVotes) {
      byGuest.set(v.guest_id, (byGuest.get(v.guest_id) ?? 0) + 1);
    }
    let n = 0;
    for (const count of byGuest.values()) if (count === 10) n += 1;
    return n;
  }, [allVotes]);

  // Total guests for the X of N display — count via the realtime guests fetch we already did.
  // (We just count the votes by distinct guest_id we know about; the lobby fetch isn't refreshed
  // realtime here, so for the denominator we count all distinct guests we've seen at least once.)
  const totalJurors = useMemo(() => {
    const ids = new Set<string>();
    for (const v of allVotes) ids.add(v.guest_id);
    if (me) ids.add(me.id);
    return Math.max(ids.size, 1);
  }, [allVotes, me]);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (isLocked) return;
    const code = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;

    if (overId === UNRANKED_BUCKET) {
      // Removed back to unranked.
      setRanking((prev) => {
        const next = { ...prev };
        for (const p of POINTS_POOL) if (next[p] === code) next[p] = null;
        return next;
      });
      return;
    }
    const targetPoints = Number(overId);
    if (!POINTS_POOL.includes(targetPoints as 12)) return;

    setRanking((prev) => {
      const next = { ...prev };
      // Wherever this code currently sits (if anywhere), clear it.
      for (const p of POINTS_POOL) if (next[p] === code) next[p] = null;
      // If target slot occupied, that country goes back to unranked.
      // (We simply overwrite — the displaced country falls out.)
      next[targetPoints] = code;
      return next;
    });
  };

  const onLock = () => {
    if (!guestId) return;
    setError(null);
    const missing = POINTS_POOL.filter((p) => !ranking[p]);
    if (missing.length > 0) {
      setError(`Fill all ${POINTS_POOL.length} slots before locking in.`);
      return;
    }
    const rankingPayload = POINTS_POOL.map((p) => ({
      points: p,
      country_code: ranking[p] as string,
    }));
    startTransition(async () => {
      const res = await lockVotes(guestId, rankingPayload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Mirror locally so the UI flips to "locked" without a refetch.
      setMyVotes(
        rankingPayload.map((r) => ({
          guest_id: guestId,
          country_code: r.country_code,
          points: r.points,
          cast_at: new Date().toISOString(),
        })),
      );
    });
  };

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (party && party.phase !== 'voting') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 py-10">
        <Card className="w-full border-eurogold-500/40 bg-card/70 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-center">Voting is closed right now</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            We&apos;re currently in <span className="font-semibold">{party.phase}</span>.
            Voting unlocks when the host hits the button.
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!me || !guestId) return null;

  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="bg-gradient-to-br from-eurorose-500 via-eurorose-300 to-eurogold-300 bg-clip-text text-2xl font-black tracking-tight text-transparent">
            Cast your jury vote
          </h1>
          <p className="text-xs text-muted-foreground">
            Drag countries onto the ladder. {lockedJurors}/{totalJurors} jurors locked in.
          </p>
        </div>
        {isLocked && (
          <span className="rounded-full bg-eurogold-500/20 px-3 py-1 text-xs font-bold text-eurogold-400">
            Vote locked ✅
          </span>
        )}
      </header>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Unranked column */}
          <UnrankedColumn
            countries={unrankedCandidates}
            myReactions={myReactions}
            locked={isLocked}
          />
          {/* Ladder */}
          <Ladder
            ranking={ranking}
            countriesByCode={countriesByCode}
            myReactions={myReactions}
            locked={isLocked}
          />
        </div>

        <DragOverlay>
          {activeId ? (
            <CountryChip
              country={countriesByCode[activeId]}
              myRating={myReactions[activeId]?.rating ?? null}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="mt-6 space-y-2">
        <Button
          className="h-12 w-full text-base font-semibold"
          onClick={onLock}
          disabled={isLocked || pending}
        >
          {isLocked ? 'Vote locked ✅' : pending ? 'Locking…' : 'Lock in my vote'}
        </Button>
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}

// ---- helpers ---------------------------------------------------------

function UnrankedColumn({
  countries,
  myReactions,
  locked,
}: {
  countries: Country[];
  myReactions: Record<string, Reaction>;
  locked: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNRANKED_BUCKET, disabled: locked });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 border-dashed p-2 transition-colors ${
        isOver ? 'border-eurogold-400 bg-eurogold-500/10' : 'border-border/40 bg-secondary/10'
      }`}
    >
      <p className="mb-2 px-1 text-xs uppercase tracking-widest text-muted-foreground">
        Unranked ({countries.length})
      </p>
      <div className="grid grid-cols-2 gap-2">
        {countries.map((c) => (
          <DraggableCountry
            key={c.code}
            country={c}
            myRating={myReactions[c.code]?.rating ?? null}
            disabled={locked}
          />
        ))}
        {countries.length === 0 && (
          <p className="col-span-2 px-1 py-3 text-center text-xs text-muted-foreground">
            All assigned ✓
          </p>
        )}
      </div>
    </div>
  );
}

function Ladder({
  ranking,
  countriesByCode,
  myReactions,
  locked,
}: {
  ranking: Record<number, string | null>;
  countriesByCode: Record<string, Country>;
  myReactions: Record<string, Reaction>;
  locked: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {POINTS_POOL.map((p) => (
        <PointsSlot
          key={p}
          points={p}
          code={ranking[p]}
          country={ranking[p] ? countriesByCode[ranking[p] as string] : null}
          myRating={
            ranking[p] ? myReactions[ranking[p] as string]?.rating ?? null : null
          }
          locked={locked}
        />
      ))}
    </div>
  );
}

function PointsSlot({
  points,
  code,
  country,
  myRating,
  locked,
}: {
  points: number;
  code: string | null;
  country: Country | null | undefined;
  myRating: number | null;
  locked: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: String(points),
    disabled: locked,
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 rounded-lg border bg-secondary/20 p-1.5 transition-colors ${
        isOver ? 'border-eurogold-400 bg-eurogold-500/10' : 'border-border/40'
      }`}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-eurogold-500 to-eurorose-500 text-lg font-black text-black">
        {points}
      </div>
      <div className="min-w-0 flex-1">
        {country ? (
          <DraggableCountry country={country} myRating={myRating} disabled={locked} compact />
        ) : (
          <p className="px-2 text-xs text-muted-foreground">Drop a country here</p>
        )}
      </div>
    </div>
  );
}

function DraggableCountry({
  country,
  myRating,
  disabled,
  compact,
}: {
  country: Country;
  myRating: number | null;
  disabled: boolean;
  compact?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: country.code,
    disabled,
  });
  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : {};
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`select-none touch-none ${isDragging ? 'opacity-30' : ''}`}
    >
      <CountryChip country={country} myRating={myRating} compact={compact} />
    </div>
  );
}

function CountryChip({
  country,
  myRating,
  dragging,
  compact,
}: {
  country?: Country;
  myRating: number | null;
  dragging?: boolean;
  compact?: boolean;
}) {
  if (!country) return null;
  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-border/60 bg-card/80 px-2 py-2 shadow-sm backdrop-blur ${
        dragging ? 'rotate-2 scale-105 shadow-2xl' : ''
      }`}
    >
      <span className="text-xl leading-none">{country.flag_emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">
          {country.name}
        </p>
        {!compact && country.artist && (
          <p className="truncate text-[10px] text-muted-foreground">
            {country.artist}
          </p>
        )}
      </div>
      {myRating != null && (
        <span className="rounded-full bg-eurorose-500/20 px-1.5 py-0.5 text-[10px] text-eurorose-300">
          {RATING_EMOJI[myRating] ?? ''}
        </span>
      )}
    </div>
  );
}

const RATING_EMOJI: Record<number, string> = {
  1: '😍',
  2: '😂',
  3: '🙃',
  4: '😴',
  5: '🤯',
};
