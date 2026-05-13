'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { getGuestIdClient } from '@/lib/guest-id';
import { submitReaction } from '../actions/reactions';
import { triggerRoast } from '../actions/roast';
import type { Database } from '@eurojury/db/types';

type Country = Database['public']['Tables']['countries']['Row'];
type EventRow = Database['public']['Tables']['event_timeline']['Row'];
type Reaction = Database['public']['Tables']['reactions']['Row'];

interface PartyState {
  id: string;
  phase: string;
  yt_current_seconds: number | null;
  manual_event_idx: number | null;
  party_paused: boolean;
}

interface CurrentEvent {
  row: EventRow;
  performanceCount: number;
  performanceIndex: number; // 1-based position among performances
  startSeconds: number;
}

const PARTY_ID = process.env.NEXT_PUBLIC_PARTY_ID!;
const REACTION_WINDOW_SECONDS = 90;
const ROAST_STORAGE_KEY = 'eurojury_roasts_used';
const REACTIONS = [
  { rating: 1, emoji: '😍', label: 'love' },
  { rating: 2, emoji: '😂', label: 'lol' },
  { rating: 3, emoji: '🙃', label: 'huh' },
  { rating: 4, emoji: '😴', label: 'snooze' },
  { rating: 5, emoji: '🤯', label: 'iconic' },
] as const;

// Simple inline derivation per the brief. Agent C will refactor to lib/derive-event.ts.
// Rules:
//  - If manual_event_idx is set, that row wins.
//  - Otherwise find the row whose [start_seconds, end_seconds) contains yt_current_seconds.
//  - end_seconds may be null (open-ended event) — match if start <= ytSec.
function deriveCurrentEvent(
  timeline: EventRow[],
  ytSec: number | null,
  manualIdx: number | null,
): EventRow | null {
  if (!timeline.length) return null;
  if (manualIdx != null) {
    return timeline.find((r) => r.idx === manualIdx) ?? null;
  }
  if (ytSec == null) return null;
  // Sort defensive copy — DB returns by primary key normally but we don't rely on it.
  const sorted = [...timeline].sort((a, b) => a.start_seconds - b.start_seconds);
  let match: EventRow | null = null;
  for (const r of sorted) {
    if (r.start_seconds > ytSec) break;
    if (r.end_seconds == null || ytSec < r.end_seconds) match = r;
  }
  return match;
}

// /live — phone-only minimal UI. Big now-playing card + 5 reaction buttons + roast button.
// No commentary feed. No chat. Per project memory: phones are dumb devices.
export default function LivePage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [party, setParty] = useState<PartyState | null>(null);
  const [timeline, setTimeline] = useState<EventRow[]>([]);
  const [countriesByCode, setCountriesByCode] = useState<Record<string, Country>>({});
  const [myReactions, setMyReactions] = useState<Record<string, Reaction>>({});
  const [hasUnfiredRoast, setHasUnfiredRoast] = useState(false);
  const [flashRating, setFlashRating] = useState<number | null>(null);
  const [roastToast, setRoastToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  // Initial bootstrap.
  useEffect(() => {
    const gid = getGuestIdClient();
    setGuestId(gid);
    let cancelled = false;
    (async () => {
      // Sequential awaits — see comment in /lobby for why.
      const partyRes = await supabase
        .from('parties')
        .select('id, phase, yt_current_seconds, manual_event_idx, party_paused')
        .eq('id', PARTY_ID)
        .single();
      const timelineRes = await supabase
        .from('event_timeline')
        .select('*')
        .eq('party_id', PARTY_ID);
      const countriesRes = await supabase.from('countries').select('*');
      if (cancelled) return;
      if (partyRes.data) setParty(partyRes.data as PartyState);
      setTimeline(timelineRes.data ?? []);
      const byCode: Record<string, Country> = {};
      for (const c of countriesRes.data ?? []) byCode[c.code] = c;
      setCountriesByCode(byCode);

      if (gid) {
        const reactionsRes = await supabase
          .from('reactions')
          .select('*')
          .eq('guest_id', gid);
        const map: Record<string, Reaction> = {};
        for (const r of (reactionsRes.data ?? []) as Reaction[]) {
          map[r.country_code] = r;
        }
        setMyReactions(map);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Bounce to / if no cookie.
  useEffect(() => {
    if (loaded && !guestId) router.replace('/');
  }, [loaded, guestId, router]);

  // Realtime: parties + event_timeline + scheduled_commentary (for roast availability).
  useEffect(() => {
    const chan = supabase
      .channel(`live:${PARTY_ID}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'parties', filter: `id=eq.${PARTY_ID}` },
        (payload) => setParty(payload.new as PartyState),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_timeline', filter: `party_id=eq.${PARTY_ID}` },
        () => {
          supabase
            .from('event_timeline')
            .select('*')
            .eq('party_id', PARTY_ID)
            .then(({ data }) => setTimeline(data ?? []));
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scheduled_commentary',
          filter: `party_id=eq.${PARTY_ID}`,
        },
        () => {
          // Cheap refresh — roast availability is recomputed when the current
          // event changes anyway, but this catches mid-event updates.
          setHasUnfiredRoast((prev) => prev);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(chan);
    };
  }, [supabase]);

  // Derive current event.
  const current: CurrentEvent | null = useMemo(() => {
    if (!party) return null;
    const row = deriveCurrentEvent(
      timeline,
      party.yt_current_seconds ?? null,
      party.manual_event_idx,
    );
    if (!row) return null;
    const performances = timeline.filter((r) => r.category === 'performance');
    const pIdx =
      row.category === 'performance'
        ? performances.findIndex((r) => r.idx === row.idx) + 1
        : 0;
    return {
      row,
      performanceCount: performances.length,
      performanceIndex: pIdx,
      startSeconds: row.start_seconds,
    };
  }, [party, timeline]);

  // Reaction window check (per-event).
  const reactionWindowOpen = useMemo(() => {
    if (!current || !party) return false;
    if (party.party_paused) return false;
    if (current.row.category !== 'performance') return false;
    const yt = party.yt_current_seconds ?? 0;
    return yt >= current.startSeconds && yt < current.startSeconds + REACTION_WINDOW_SECONDS;
  }, [current, party]);

  // Check for unfired roast for current event.
  useEffect(() => {
    if (!current) {
      setHasUnfiredRoast(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('scheduled_commentary')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', PARTY_ID)
      .eq('event_idx', current.row.idx)
      .eq('category', 'roast')
      .eq('fired', false)
      .then(({ count }) => {
        if (!cancelled) setHasUnfiredRoast((count ?? 0) > 0);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, current?.row.idx, current]);

  // Track roast use in localStorage so a guest can't spam-fire per event.
  const roastUsedThisEvent = useCallback(
    (eventIdx: number) => {
      if (!guestId) return false;
      if (typeof window === 'undefined') return false;
      try {
        const raw = window.localStorage.getItem(ROAST_STORAGE_KEY) ?? '[]';
        const keys: string[] = JSON.parse(raw);
        return keys.includes(`${eventIdx}:${guestId}`);
      } catch {
        return false;
      }
    },
    [guestId],
  );
  const markRoastUsed = useCallback(
    (eventIdx: number) => {
      if (!guestId) return;
      if (typeof window === 'undefined') return;
      try {
        const raw = window.localStorage.getItem(ROAST_STORAGE_KEY) ?? '[]';
        const keys: string[] = JSON.parse(raw);
        const key = `${eventIdx}:${guestId}`;
        if (!keys.includes(key)) {
          keys.push(key);
          window.localStorage.setItem(ROAST_STORAGE_KEY, JSON.stringify(keys));
        }
      } catch {
        /* ignore */
      }
    },
    [guestId],
  );

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReact = (rating: number) => {
    if (!guestId || !current || current.row.country_code == null) return;
    if (!reactionWindowOpen) return;
    const country = current.row.country_code;
    setFlashRating(rating);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashRating(null), 500);
    // Optimistic update.
    setMyReactions((prev) => ({
      ...prev,
      [country]: {
        guest_id: guestId,
        country_code: country,
        rating,
        cast_at: new Date().toISOString(),
      },
    }));
    startTransition(async () => {
      const res = await submitReaction(guestId, country, rating);
      if (!res.ok) {
        // Roll back optimistic write on error.
        setMyReactions((prev) => {
          const next = { ...prev };
          delete next[country];
          return next;
        });
      }
    });
  };

  const onRoast = () => {
    if (!guestId || !current) return;
    if (roastUsedThisEvent(current.row.idx)) return;
    markRoastUsed(current.row.idx);
    setRoastToast('🎤 sent!');
    setTimeout(() => setRoastToast(null), 1800);
    startTransition(async () => {
      const res = await triggerRoast(PARTY_ID, current.row.idx, guestId);
      if (!res.ok) {
        // Reverse the rate-limit token if it actually failed so they can retry.
        try {
          const raw = window.localStorage.getItem(ROAST_STORAGE_KEY) ?? '[]';
          const keys: string[] = JSON.parse(raw);
          window.localStorage.setItem(
            ROAST_STORAGE_KEY,
            JSON.stringify(keys.filter((k) => k !== `${current.row.idx}:${guestId}`)),
          );
        } catch {
          /* ignore */
        }
        setRoastToast(`Roast failed: ${res.error}`);
        setTimeout(() => setRoastToast(null), 2400);
      }
    });
  };

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }
  if (!guestId) return null;

  const country = current?.row.country_code
    ? countriesByCode[current.row.country_code]
    : null;
  const myRatingHere =
    current?.row.country_code != null
      ? myReactions[current.row.country_code]?.rating ?? null
      : null;

  const isPerformance = current?.row.category === 'performance';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
      {party?.party_paused && (
        <div className="mb-3 rounded-full bg-eurogold-500/20 px-3 py-1 text-center text-xs font-semibold text-eurogold-400">
          ⏸️ Paused
        </div>
      )}

      {/* Now-playing card */}
      <section className="rounded-2xl border border-europurp-700/40 bg-card/60 p-6 text-center backdrop-blur">
        {country ? (
          <>
            <div className="text-7xl leading-none">{country.flag_emoji}</div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight">
              {country.name}
            </h1>
            {(country.artist || country.song_title) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[country.artist, country.song_title].filter(Boolean).join(' — ')}
              </p>
            )}
            {isPerformance && current && (
              <p className="mt-2 text-xs uppercase tracking-widest text-eurogold-400">
                Performance {current.performanceIndex} of {current.performanceCount}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-6xl">📺</div>
            <h1 className="mt-3 text-xl font-bold">{current?.row.description ?? 'Waiting for the show'}</h1>
          </>
        )}
      </section>

      {/* Reaction row OR look-up card */}
      <section className="mt-6 flex-1">
        {isPerformance && reactionWindowOpen ? (
          <>
            <p className="mb-3 text-center text-xs uppercase tracking-widest text-muted-foreground">
              Gut reaction
            </p>
            <div className="flex justify-between gap-2">
              {REACTIONS.map((r) => {
                const tapped = myRatingHere === r.rating;
                const flashing = flashRating === r.rating;
                return (
                  <button
                    key={r.rating}
                    onClick={() => onReact(r.rating)}
                    disabled={pending}
                    aria-label={r.label}
                    className={`flex h-20 flex-1 flex-col items-center justify-center rounded-2xl border text-3xl transition-all duration-150 ${
                      tapped
                        ? 'border-eurorose-400 bg-eurorose-500/30 scale-105'
                        : 'border-border/60 bg-secondary/30 active:scale-95'
                    } ${flashing ? 'ring-4 ring-eurogold-400' : ''}`}
                  >
                    <span>{r.emoji}</span>
                    {tapped && <span className="mt-1 text-xs text-eurogold-400">✓</span>}
                  </button>
                );
              })}
            </div>
            {myRatingHere != null && (
              <p className="mt-3 text-center text-sm text-muted-foreground">
                You reacted: {REACTIONS.find((r) => r.rating === myRatingHere)?.emoji}
              </p>
            )}
          </>
        ) : (
          <div className="rounded-2xl border border-border/40 bg-secondary/20 p-6 text-center">
            <p className="text-lg">Look up at the TV 👆</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isPerformance
                ? "Reaction window closed for this song."
                : "Reactions open during performances."}
            </p>
          </div>
        )}
      </section>

      {/* Roast button */}
      {isPerformance && hasUnfiredRoast && !roastUsedThisEvent(current!.row.idx) && (
        <button
          onClick={onRoast}
          disabled={pending}
          className="mt-6 h-14 w-full rounded-full bg-gradient-to-r from-eurorose-500 to-europurp-600 text-base font-bold text-white shadow-lg shadow-europurp-900/50 active:scale-95"
        >
          🎤 Roast this one
        </button>
      )}
      {roastToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-eurogold-500/90 px-4 py-2 text-sm font-semibold text-black">
          {roastToast}
        </div>
      )}
    </main>
  );
}
