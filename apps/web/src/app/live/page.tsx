'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { getGuestIdClient } from '@/lib/guest-id';
import { useCurrentEvent } from '@/lib/use-current-event';
import { useEventTimeline } from '@/lib/use-event-timeline';
import { submitReaction } from '../actions/reactions';
import { triggerReaction, type ReactionKind } from '../actions/roast';
import type { Database } from '@eurojury/db/types';

type Country = Database['public']['Tables']['countries']['Row'];
type Reaction = Database['public']['Tables']['reactions']['Row'];

const PARTY_ID = process.env.NEXT_PUBLIC_PARTY_ID!;
const REACTION_WINDOW_SECONDS = 90;
const REACTION_USED_KEY = 'eurojury_reactions_used';
const REACTION_KINDS: ReadonlyArray<{
  kind: ReactionKind;
  label: string;
  emoji: string;
  className: string;
}> = [
  {
    kind: 'roast',
    label: 'Roast it',
    emoji: '🔥',
    className: 'bg-gradient-to-r from-eurorose-500 to-europurp-600 shadow-europurp-900/50',
  },
  {
    kind: 'celebrate',
    label: 'Celebrate it',
    emoji: '🎉',
    className: 'bg-gradient-to-r from-eurogold-400 to-eurogold-600 text-black shadow-eurogold-900/40',
  },
];
const REACTIONS = [
  { rating: 1, emoji: '😍', label: 'love' },
  { rating: 2, emoji: '😂', label: 'lol' },
  { rating: 3, emoji: '🙃', label: 'huh' },
  { rating: 4, emoji: '😴', label: 'snooze' },
  { rating: 5, emoji: '🤯', label: 'iconic' },
] as const;

// /live — phone-only minimal UI. Big now-playing card + 5 reaction buttons + roast button.
// No commentary feed. No chat. Per project memory: phones are dumb devices.
//
// All event-derivation logic lives in `useCurrentEvent` (which composes
// `useParty` + `useEventTimeline` + the pure `deriveEvent` lib). This page
// only owns UI state: which reaction the guest tapped, whether the roast
// has been spent for this event, and the country lookup table.
export default function LivePage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [countriesByCode, setCountriesByCode] = useState<Record<string, Country>>({});
  const [myReactions, setMyReactions] = useState<Record<string, Reaction>>({});
  const [hasUnfired, setHasUnfired] = useState<{ roast: boolean; celebrate: boolean }>({
    roast: false,
    celebrate: false,
  });
  const [flashRating, setFlashRating] = useState<number | null>(null);
  const [reactionToast, setReactionToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  // Shared event/timeline subscriptions — same data /tv consumes.
  const { current, effectiveSeconds, effectivePaused } = useCurrentEvent(PARTY_ID);
  const { timeline } = useEventTimeline(PARTY_ID);

  // Initial bootstrap — guest id, country lookup, this guest's prior reactions.
  useEffect(() => {
    const gid = getGuestIdClient();
    setGuestId(gid);
    let cancelled = false;
    (async () => {
      const countriesRes = await supabase.from('countries').select('*');
      if (cancelled) return;
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

  // Performance index (1-based) for the "Performance N of M" pill.
  const performanceInfo = useMemo(() => {
    if (!current || current.category !== 'performance') {
      return { index: 0, count: 0 };
    }
    const performances = timeline.filter((r) => r.category === 'performance');
    const idx = performances.findIndex((r) => r.idx === current.idx) + 1;
    return { index: idx, count: performances.length };
  }, [current, timeline]);

  // Reaction window check (per-event). Uses `effectiveSeconds` from the
  // derive hook so this Just Works under fake_broadcast as well as real
  // YouTube playback.
  const reactionWindowOpen = useMemo(() => {
    if (!current) return false;
    if (effectivePaused) return false;
    if (current.category !== 'performance') return false;
    return (
      effectiveSeconds >= current.startSeconds &&
      effectiveSeconds < current.startSeconds + REACTION_WINDOW_SECONDS
    );
  }, [current, effectiveSeconds, effectivePaused]);

  // Check for unfired roast/celebrate entries for current event. Refreshes
  // whenever the current event changes; a Realtime subscription on
  // scheduled_commentary catches mid-event updates.
  useEffect(() => {
    if (!current) {
      setHasUnfired({ roast: false, celebrate: false });
      return;
    }
    let cancelled = false;
    const fetchAvail = async () => {
      const [{ count: roastCount }, { count: celebCount }] = await Promise.all([
        supabase
          .from('scheduled_commentary')
          .select('id', { count: 'exact', head: true })
          .eq('party_id', PARTY_ID)
          .eq('event_idx', current.idx)
          .eq('category', 'roast')
          .eq('fired', false),
        supabase
          .from('scheduled_commentary')
          .select('id', { count: 'exact', head: true })
          .eq('party_id', PARTY_ID)
          .eq('event_idx', current.idx)
          .eq('category', 'celebrate')
          .eq('fired', false),
      ]);
      if (!cancelled) {
        setHasUnfired({
          roast: (roastCount ?? 0) > 0,
          celebrate: (celebCount ?? 0) > 0,
        });
      }
    };
    void fetchAvail();
    const chan = supabase
      .channel(`reaction-avail:${PARTY_ID}:${current.idx}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scheduled_commentary',
          filter: `party_id=eq.${PARTY_ID}`,
        },
        () => {
          void fetchAvail();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(chan);
    };
  }, [supabase, current?.idx, current]);

  // Track reaction use in localStorage so a guest can't spam-fire per event/kind.
  // Storage shape: array of "<eventIdx>:<kind>:<guestId>" strings.
  const reactionUsedThisEvent = useCallback(
    (eventIdx: number, kind: ReactionKind) => {
      if (!guestId) return false;
      if (typeof window === 'undefined') return false;
      try {
        const raw = window.localStorage.getItem(REACTION_USED_KEY) ?? '[]';
        const keys: string[] = JSON.parse(raw);
        return keys.includes(`${eventIdx}:${kind}:${guestId}`);
      } catch {
        return false;
      }
    },
    [guestId],
  );
  const markReactionUsed = useCallback(
    (eventIdx: number, kind: ReactionKind) => {
      if (!guestId) return;
      if (typeof window === 'undefined') return;
      try {
        const raw = window.localStorage.getItem(REACTION_USED_KEY) ?? '[]';
        const keys: string[] = JSON.parse(raw);
        const key = `${eventIdx}:${kind}:${guestId}`;
        if (!keys.includes(key)) {
          keys.push(key);
          window.localStorage.setItem(REACTION_USED_KEY, JSON.stringify(keys));
        }
      } catch {
        /* ignore */
      }
    },
    [guestId],
  );
  const unmarkReactionUsed = useCallback(
    (eventIdx: number, kind: ReactionKind) => {
      if (!guestId) return;
      if (typeof window === 'undefined') return;
      try {
        const raw = window.localStorage.getItem(REACTION_USED_KEY) ?? '[]';
        const keys: string[] = JSON.parse(raw);
        window.localStorage.setItem(
          REACTION_USED_KEY,
          JSON.stringify(keys.filter((k) => k !== `${eventIdx}:${kind}:${guestId}`)),
        );
      } catch {
        /* ignore */
      }
    },
    [guestId],
  );

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReact = (rating: number) => {
    if (!guestId || !current || current.countryCode == null) return;
    if (!reactionWindowOpen) return;
    const country = current.countryCode;
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

  const onReaction = (kind: ReactionKind) => {
    if (!guestId || !current) return;
    if (reactionUsedThisEvent(current.idx, kind)) return;
    markReactionUsed(current.idx, kind);
    const toastMsg = kind === 'roast' ? '🔥 sent!' : '🎉 sent!';
    setReactionToast(toastMsg);
    setTimeout(() => setReactionToast(null), 1800);
    startTransition(async () => {
      const res = await triggerReaction(PARTY_ID, current.idx, guestId, kind);
      if (!res.ok) {
        unmarkReactionUsed(current.idx, kind);
        setReactionToast(`${kind === 'roast' ? 'Roast' : 'Celebrate'} failed: ${res.error}`);
        setTimeout(() => setReactionToast(null), 2400);
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

  const country = current?.countryCode ? countriesByCode[current.countryCode] : null;
  const myRatingHere =
    current?.countryCode != null
      ? myReactions[current.countryCode]?.rating ?? null
      : null;

  const isPerformance = current?.category === 'performance';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
      {effectivePaused && (
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
            {isPerformance && performanceInfo.count > 0 && (
              <p className="mt-2 text-xs uppercase tracking-widest text-eurogold-400">
                Performance {performanceInfo.index} of {performanceInfo.count}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-6xl">📺</div>
            <h1 className="mt-3 text-xl font-bold">{current?.description ?? 'Waiting for the show'}</h1>
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

      {/* Reaction buttons — roast and celebrate are independent (1 of each per event). */}
      {isPerformance && current && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {REACTION_KINDS.map(({ kind, label, emoji, className }) => {
            const available = hasUnfired[kind];
            const used = reactionUsedThisEvent(current.idx, kind);
            const visible = available && !used;
            if (!visible) return <div key={kind} />;
            return (
              <button
                key={kind}
                onClick={() => onReaction(kind)}
                disabled={pending}
                className={`h-14 rounded-full text-base font-bold shadow-lg active:scale-95 ${className}`}
              >
                {emoji} {label}
              </button>
            );
          })}
        </div>
      )}
      {reactionToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-eurogold-500/90 px-4 py-2 text-sm font-semibold text-black">
          {reactionToast}
        </div>
      )}
    </main>
  );
}
