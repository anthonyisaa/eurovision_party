'use client';

// /tv — the phase-aware TV surface.
//
// This is the focal point of the party. It runs in two layout modes:
//   - Electron overlay (`?electron=1`): body is transparent; only the actual
//     content cards/bubbles render so the YouTube window underneath is the
//     dominant visual. The container is pointer-events-none; interactive
//     children opt back in with pointer-events-auto if needed.
//   - Fullscreen (default, no query param): rich Eurovision gradient
//     background, used when serving the TV without Electron (e.g. straight
//     into a Chrome tab on a TV stick) or when smoke-testing.
//
// Phase routing:
//   - lobby   → QR + roster + countdown (fullscreen even in Electron mode)
//   - live    → corner overlays (transparent in Electron; lobby-style grid
//               otherwise)
//   - voting  → "JURY IS DELIBERATING" + locked-in progress (fullscreen)
//   - reveal  → mount Agent D's <RevealStage /> as-is
//   - closed  → podium + leaderboards (fullscreen)
//
// All data flows through the shared hooks (`useParty`, `useEventTimeline`,
// `useCurrentEvent`). The page never writes to Supabase — pure reader.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useParty } from '@/lib/use-party';
import { useEventTimeline } from '@/lib/use-event-timeline';
import { useCurrentEvent } from '@/lib/use-current-event';
import { RevealStage } from '@/components/reveal/RevealStage';
import { tallyRoomResults, type Vote } from '@/lib/scoring';
import {
  predictionLeaderboard,
  sideBetLeaderboard,
  type GuestScore,
} from '@/lib/leaderboards';
import type { Database } from '@eurojury/db/types';

type Country = Database['public']['Tables']['countries']['Row'];
type Guest = Database['public']['Tables']['guests']['Row'];
type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
type Reaction = Database['public']['Tables']['reactions']['Row'];
type VoteRow = Database['public']['Tables']['votes']['Row'];
type Prediction = Database['public']['Tables']['predictions']['Row'];
type SideBet = Database['public']['Tables']['side_bets']['Row'];
type SideBetPickRow = Database['public']['Tables']['side_bet_picks']['Row'];

interface ActualResultEntry {
  position: number;
  country_code: string;
}

const REACTION_EMOJIS: Record<number, string> = {
  1: '😍',
  2: '😂',
  3: '🙃',
  4: '😴',
  5: '🤯',
};

// Bubble TTL — speech bubbles fade out 12s after their created_at timestamp.
const BUBBLE_TTL_MS = 12_000;

// useSearchParams() needs a Suspense boundary at build time.
export default function TvPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <TvPageInner />
    </Suspense>
  );
}

function LoadingFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-europurp-900 via-background to-eurorose-950 p-6 text-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </main>
  );
}

function TvPageInner() {
  const search = useSearchParams();
  // ?party=… wins over NEXT_PUBLIC_PARTY_ID so the Electron launcher can
  // point at any party without rebuilding the web app.
  const partyId =
    search?.get('party') ?? process.env.NEXT_PUBLIC_PARTY_ID ?? '';
  const isElectron = search?.get('electron') === '1';

  const { party } = useParty(partyId);
  const { timeline } = useEventTimeline(partyId);
  const { current } = useCurrentEvent(partyId);

  // No party id at all — render a small static error rather than crash.
  if (!partyId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <p className="text-sm text-destructive">
          No party id — pass ?party=… or set NEXT_PUBLIC_PARTY_ID.
        </p>
      </main>
    );
  }

  const phase = (party?.phase ?? 'lobby') as
    | 'lobby'
    | 'live'
    | 'voting'
    | 'reveal'
    | 'closed';

  // Outer wrapper styling differs by mode. In Electron the OUTER container
  // must be transparent + pointer-events-none so clicks pass through to YT;
  // individual overlay cards opt back into pointer-events-auto if they need
  // to be clickable (none currently do — the TV is read-only).
  const outerClass = isElectron
    ? 'pointer-events-none min-h-screen w-full bg-transparent text-foreground'
    : 'min-h-screen w-full bg-gradient-to-br from-europurp-900 via-background to-eurorose-950 text-foreground';

  // Inject a body-level CSS reset for Electron transparency — Next/Tailwind
  // defaults to `bg-background` on the body; we override it from the
  // overlay so the Electron BrowserWindow's transparency is preserved.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isElectron) return;
    const prev = document.body.style.background;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    return () => {
      document.body.style.background = prev;
      document.documentElement.style.background = '';
    };
  }, [isElectron]);

  return (
    <main className={outerClass}>
      {/* Pause pill — top-right, always visible across phases */}
      {party?.party_paused && (
        <div className="pointer-events-auto fixed right-4 top-4 z-40 rounded-full border border-eurorose-500/60 bg-eurorose-500/90 px-4 py-2 text-sm font-bold text-white shadow-lg backdrop-blur">
          ⏸ Paused
          {party.party_pause_reason ? (
            <span className="ml-2 font-normal opacity-90">
              · {party.party_pause_reason}
            </span>
          ) : null}
        </div>
      )}

      {/* Phase indicator — bottom-right, small */}
      <div className="pointer-events-none fixed bottom-3 right-3 z-30 rounded-full border border-border/40 bg-card/70 px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground backdrop-blur">
        {phase}
      </div>

      <AnimatePresence mode="wait">
        {phase === 'lobby' && (
          <LobbyPhase
            key="lobby"
            partyId={partyId}
            partyName={party?.name ?? 'Eurojury'}
          />
        )}
        {phase === 'live' && (
          <LivePhase
            key="live"
            partyId={partyId}
            isElectron={isElectron}
            current={current}
            timeline={timeline}
            ytVideoId={party?.yt_video_id ?? null}
          />
        )}
        {phase === 'voting' && (
          <VotingPhase key="voting" partyId={partyId} />
        )}
        {phase === 'reveal' && (
          <motion.div
            key="reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <RevealStage
              partyId={partyId}
              revealStep={party?.reveal_step ?? 0}
              actualResults={
                (party?.actual_results ?? null) as ActualResultEntry[] | null
              }
            />
          </motion.div>
        )}
        {phase === 'closed' && (
          <ClosedPhase
            key="closed"
            partyId={partyId}
            actualResults={
              (party?.actual_results ?? null) as ActualResultEntry[] | null
            }
          />
        )}
      </AnimatePresence>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Lobby — QR code, party name, roster, predictions countdown.
// Fullscreen takeover even in Electron mode (no YouTube playing yet).
// ---------------------------------------------------------------------------

function LobbyPhase({
  partyId,
  partyName,
}: {
  partyId: string;
  partyName: string;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [countriesByCode, setCountriesByCode] = useState<
    Record<string, Country>
  >({});
  const [joinUrl, setJoinUrl] = useState('');

  // Compose the join URL client-side so it always matches whatever origin
  // the TV browser is pointed at (works for localhost dev and prod alike).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setJoinUrl(`${window.location.origin}/`);
  }, []);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    (async () => {
      const [countriesRes, guestsRes] = await Promise.all([
        supabase.from('countries').select('*'),
        supabase.from('guests').select('*').eq('party_id', partyId),
      ]);
      if (cancelled) return;
      const byCode: Record<string, Country> = {};
      for (const c of countriesRes.data ?? []) byCode[c.code] = c;
      setCountriesByCode(byCode);
      setGuests(guestsRes.data ?? []);
    })();

    const chan = supabase
      .channel(`tv-lobby:${partyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'guests',
          filter: `party_id=eq.${partyId}`,
        },
        () => {
          supabase
            .from('guests')
            .select('*')
            .eq('party_id', partyId)
            .then(({ data }) => {
              if (!cancelled) setGuests(data ?? []);
            });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(chan);
    };
  }, [supabase, partyId]);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center gap-10 px-8 py-12"
    >
      <div className="text-center">
        <h1 className="bg-gradient-to-br from-eurorose-400 via-eurogold-400 to-europurp-500 bg-clip-text text-7xl font-black tracking-tight text-transparent md:text-9xl">
          Eurojury 🇪🇺
        </h1>
        <p className="mt-3 text-xl text-muted-foreground md:text-2xl">
          {partyName}
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-8 md:grid-cols-[auto,1fr] md:items-center">
        {joinUrl && (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-eurogold-500/40 bg-white p-6 shadow-2xl">
            <QRCodeSVG value={joinUrl} size={220} level="M" />
            <p className="text-center text-xs font-bold uppercase tracking-widest text-black">
              Scan to join
            </p>
            <p className="text-center text-xs text-black/70">{joinUrl}</p>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-eurogold-400">
              The jury ({guests.length})
            </p>
            <h2 className="text-3xl font-black md:text-4xl">
              Tonight&apos;s panel
            </h2>
          </div>
          {guests.length === 0 ? (
            <p className="text-base text-muted-foreground">
              No one yet — first to scan claims a hot seat.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {guests.map((g) => {
                const f1 = g.assigned_country_1
                  ? countriesByCode[g.assigned_country_1]?.flag_emoji ?? ''
                  : '';
                const f2 = g.assigned_country_2
                  ? countriesByCode[g.assigned_country_2]?.flag_emoji ?? ''
                  : '';
                return (
                  <li
                    key={g.id}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-card/60 px-4 py-3 backdrop-blur"
                  >
                    <span className="truncate font-semibold">
                      {g.display_name}
                    </span>
                    <span className="text-3xl leading-none">
                      {f1}
                      {f2}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="rounded-2xl border border-europurp-500/40 bg-europurp-500/10 p-4 text-sm text-europurp-300">
            ⏳ Predictions lock when the show advances out of lobby phase.
          </div>
        </div>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Live — corner overlays. Now-playing, reactions, speech bubbles, pause.
// In Electron mode these are individual fixed-position cards over a
// transparent body. In non-Electron mode the same data renders as a
// fullscreen grid for cases like "Eurojury on a TV without Electron".
// ---------------------------------------------------------------------------

function LivePhase({
  partyId,
  isElectron,
  current,
  timeline,
  ytVideoId,
}: {
  partyId: string;
  isElectron: boolean;
  current: ReturnType<typeof useCurrentEvent>['current'];
  timeline: Database['public']['Tables']['event_timeline']['Row'][];
  ytVideoId: string | null;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [countriesByCode, setCountriesByCode] = useState<
    Record<string, Country>
  >({});
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [bubbles, setBubbles] = useState<ChatMessage[]>([]);
  // Tick state to drive the bubble TTL fade re-render. Avoids subscribing
  // every component to setInterval.
  const [, setTick] = useState(0);

  // Bootstrap: country lookup.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('countries')
      .select('*')
      .then(({ data }) => {
        if (cancelled) return;
        const byCode: Record<string, Country> = {};
        for (const c of data ?? []) byCode[c.code] = c;
        setCountriesByCode(byCode);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Reactions for the current performance. Refetch when the event index
  // changes; subscribe to live INSERTs for the same country code.
  const currentCountry = current?.countryCode ?? null;
  useEffect(() => {
    if (!currentCountry) {
      setReactions([]);
      return;
    }
    let cancelled = false;
    supabase
      .from('reactions')
      .select('*')
      .eq('country_code', currentCountry)
      .then(({ data }) => {
        if (!cancelled) setReactions(data ?? []);
      });
    const chan = supabase
      .channel(`tv-reactions:${currentCountry}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reactions',
          filter: `country_code=eq.${currentCountry}`,
        },
        () => {
          supabase
            .from('reactions')
            .select('*')
            .eq('country_code', currentCountry)
            .then(({ data }) => {
              if (!cancelled) setReactions(data ?? []);
            });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(chan);
    };
  }, [supabase, currentCountry]);

  // Speech bubbles: subscribe to chat_messages for this party, keep the
  // last few. Older entries are filtered out by TTL when rendering.
  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    supabase
      .from('chat_messages')
      .select('*')
      .eq('party_id', partyId)
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (!cancelled) setBubbles((data ?? []).slice().reverse());
      });
    const chan = supabase
      .channel(`tv-bubbles:${partyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `party_id=eq.${partyId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as ChatMessage;
          setBubbles((prev) => [...prev, row].slice(-6));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(chan);
    };
  }, [supabase, partyId]);

  // Drive the bubble fade by re-rendering every second. Cheap; one timer.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const visibleBubbles = bubbles
    .filter((b) => now - new Date(b.created_at).getTime() < BUBBLE_TTL_MS)
    .slice(-2);

  // Performance N of M.
  const performanceInfo = useMemo(() => {
    if (!current || current.category !== 'performance') {
      return { index: 0, count: 0 };
    }
    const performances = timeline.filter((r) => r.category === 'performance');
    const idx = performances.findIndex((r) => r.idx === current.idx) + 1;
    return { index: idx, count: performances.length };
  }, [current, timeline]);

  // Aggregate reactions: count per rating for the current performance.
  const reactionCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reactions) {
      if (counts[r.rating] != null) counts[r.rating] += 1;
    }
    return counts;
  }, [reactions]);

  const country = currentCountry ? countriesByCode[currentCountry] : null;

  // Layout: Electron = absolutely-positioned corner cards over transparency.
  // Non-Electron = single column with hero now-playing + bubbles below.
  if (isElectron) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <NowPlayingCard
          current={current}
          country={country}
          performanceInfo={performanceInfo}
          variant="overlay"
        />
        <ReactionsBar counts={reactionCounts} variant="overlay" />
        <BubbleStack bubbles={visibleBubbles} variant="overlay" />
      </motion.div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-6 py-6"
    >
      {ytVideoId ? (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          {/* Left: video player */}
          <div className="space-y-4">
            <YouTubeEmbed videoId={ytVideoId} partyId={partyId} />
            <NowPlayingCard
              current={current}
              country={country}
              performanceInfo={performanceInfo}
              variant="hero"
            />
          </div>
          {/* Right: commentary stack */}
          <aside className="space-y-4">
            <BubbleStack bubbles={visibleBubbles} variant="hero" />
            <ReactionsBar counts={reactionCounts} variant="hero" />
          </aside>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-eurogold-500/40 bg-eurogold-500/10 p-4 text-sm">
            <p className="font-semibold text-eurogold-400">No video set</p>
            <p className="mt-1 text-muted-foreground">
              Paste a payload (with{' '}
              <code className="rounded bg-card/60 px-1">yt_video_id</code>) at{' '}
              <code className="rounded bg-card/60 px-1">/admin/setup</code> to embed the broadcast here.
            </p>
          </div>
          <NowPlayingCard
            current={current}
            country={country}
            performanceInfo={performanceInfo}
            variant="hero"
          />
          <div className="grid gap-6 md:grid-cols-2">
            <ReactionsBar counts={reactionCounts} variant="hero" />
            <BubbleStack bubbles={visibleBubbles} variant="hero" />
          </div>
        </>
      )}
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// YouTubeEmbed — embeds the YT iframe player AND drives the broadcast tick
// for non-Electron deployments. Polls the player's currentTime every 2s,
// upserts parties.yt_current_seconds, and fires due scheduled_commentary via
// the fire_due_commentary RPC (same flow as the Electron main process).
//
// Multiple open /tv tabs would all tick; that's safe because the RPC's
// UPDATE ... WHERE fired=false is atomic. yt_current_seconds gets last-writer
// wins, which is fine at party scale.
// ---------------------------------------------------------------------------

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    if (typeof window === 'undefined') return resolve();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.YT && w.YT.Player) return resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve();
    };
  });
  return ytApiPromise;
}

interface YouTubePlayer {
  getCurrentTime: () => number;
  getPlayerState: () => number;
  playVideo: () => void;
  unMute: () => void;
  mute: () => void;
}

function YouTubeEmbed({ videoId, partyId }: { videoId: string; partyId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const supabase = useMemo(() => supabaseBrowser(), []);
  const tickInFlight = useRef(false);
  const elementId = useMemo(() => `yt-player-${Math.random().toString(36).slice(2, 8)}`, []);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);

  // Mount the player.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const YT = (window as any).YT;
      playerRef.current = new YT.Player(elementId, {
        videoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onStateChange: (e: { data: number }) => {
            // YT.PlayerState.PLAYING === 1. If the user hits play via the
            // native YT controls (bypassing our overlay), still hide our overlay.
            if (e.data === 1 && !cancelled) setStarted(true);
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [videoId, elementId]);

  const handleStart = () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      player.unMute();
      player.playVideo();
      setStarted(true);
    } catch {
      /* swallow — user can retry */
    }
  };

  // Tick loop: poll currentTime, upsert parties, fire due commentary.
  useEffect(() => {
    const tick = async () => {
      if (tickInFlight.current) return;
      const player = playerRef.current;
      if (!player) return;
      let currentTime: number;
      let state: number;
      try {
        currentTime = player.getCurrentTime();
        state = player.getPlayerState();
      } catch {
        return;
      }
      // YT.PlayerState.PLAYING === 1. Skip ticks while paused/buffering/ended.
      if (state !== 1) return;
      if (!Number.isFinite(currentTime) || currentTime <= 0) return;
      tickInFlight.current = true;
      try {
        const seconds = Math.floor(currentTime);
        await supabase
          .from('parties')
          .update({
            yt_current_seconds: seconds,
            yt_last_update_at: new Date().toISOString(),
            yt_player_state: 'playing',
          })
          .eq('id', partyId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: due } = await (supabase.rpc as any)('fire_due_commentary', {
          p_party_id: partyId,
          p_seconds: seconds,
        });
        for (const row of (due ?? []) as Array<{
          id: string;
          speaker: string;
          content: string;
          event_idx: number | null;
        }>) {
          await supabase.from('chat_messages').insert({
            party_id: partyId,
            is_commentator: true,
            speaker: row.speaker,
            content: row.content,
            event_idx_at_post: row.event_idx,
            kind: 'scheduled',
          });
        }
      } finally {
        tickInFlight.current = false;
      }
    };
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [supabase, partyId]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border/40 bg-black shadow-xl">
      <div ref={containerRef} className="absolute inset-0">
        <div id={elementId} className="h-full w-full" />
      </div>
      {!started && (
        <button
          type="button"
          onClick={handleStart}
          disabled={!ready}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/70 text-white backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-60"
          aria-label="Start broadcast"
        >
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-eurogold-400 to-eurorose-500 text-4xl shadow-2xl shadow-eurorose-900/60 transition group-hover:scale-105">
            ▶
          </div>
          <p className="text-lg font-bold">
            {ready ? 'Start broadcast' : 'Loading player…'}
          </p>
          {ready && (
            <p className="text-xs text-white/70">
              Chrome blocks autoplay. One click and the show is live.
            </p>
          )}
        </button>
      )}
    </div>
  );
}

function NowPlayingCard({
  current,
  country,
  performanceInfo,
  variant,
}: {
  current: ReturnType<typeof useCurrentEvent>['current'];
  country: Country | null;
  performanceInfo: { index: number; count: number };
  variant: 'overlay' | 'hero';
}) {
  // Render an empty placeholder so the slot is always reserved.
  const isPerformance = current?.category === 'performance';

  const wrapperBase =
    variant === 'overlay'
      ? 'pointer-events-none fixed left-4 top-4 z-20 w-[min(420px,40vw)] rounded-2xl border border-eurogold-500/40 bg-card/85 p-4 shadow-2xl backdrop-blur'
      : 'rounded-3xl border border-eurogold-500/40 bg-card/80 p-8 shadow-2xl backdrop-blur';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={current?.idx ?? 'idle'}
        initial={{ opacity: 0, x: variant === 'overlay' ? -20 : 0, y: variant === 'hero' ? 10 : 0 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, x: variant === 'overlay' ? -20 : 0 }}
        transition={{ duration: 0.4 }}
        className={wrapperBase}
      >
        <p className="text-[10px] uppercase tracking-widest text-eurogold-400">
          Now playing
        </p>
        {country ? (
          <div className={variant === 'hero' ? 'mt-2 flex items-center gap-6' : 'mt-2 flex items-center gap-3'}>
            <span
              className={variant === 'hero' ? 'text-8xl leading-none' : 'text-5xl leading-none'}
            >
              {country.flag_emoji}
            </span>
            <div className="min-w-0">
              <p
                className={
                  variant === 'hero'
                    ? 'text-4xl font-black md:text-5xl'
                    : 'truncate text-xl font-bold'
                }
              >
                {country.name}
              </p>
              {(country.artist || country.song_title) && (
                <p
                  className={
                    variant === 'hero'
                      ? 'mt-1 text-base text-muted-foreground md:text-lg'
                      : 'truncate text-xs text-muted-foreground'
                  }
                >
                  {[country.artist, country.song_title]
                    .filter(Boolean)
                    .join(' — ')}
                </p>
              )}
              {isPerformance && performanceInfo.count > 0 && (
                <p
                  className={
                    variant === 'hero'
                      ? 'mt-2 text-xs uppercase tracking-widest text-eurorose-300'
                      : 'mt-1 text-[10px] uppercase tracking-widest text-eurorose-300'
                  }
                >
                  Performance {performanceInfo.index} of{' '}
                  {performanceInfo.count}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <p
              className={
                variant === 'hero'
                  ? 'text-3xl font-bold'
                  : 'text-base font-semibold'
              }
            >
              {current?.description ?? 'Waiting for the show'}
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function ReactionsBar({
  counts,
  variant,
}: {
  counts: Record<number, number>;
  variant: 'overlay' | 'hero';
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const ratings: Array<{ rating: number; emoji: string }> = [1, 2, 3, 4, 5].map(
    (r) => ({ rating: r, emoji: REACTION_EMOJIS[r] ?? '❓' }),
  );

  if (variant === 'overlay') {
    return (
      <div className="pointer-events-none fixed bottom-4 left-4 z-20 flex items-center gap-3 rounded-full border border-border/40 bg-card/80 px-4 py-2 shadow-xl backdrop-blur">
        {ratings.map((r) => (
          <div key={r.rating} className="flex items-center gap-1">
            <span className="text-xl leading-none">{r.emoji}</span>
            <span className="text-sm font-bold tabular-nums text-foreground">
              {counts[r.rating] ?? 0}
            </span>
          </div>
        ))}
        <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          room · {total}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        Room reactions
      </p>
      <div className="mt-3 flex justify-between gap-2">
        {ratings.map((r) => (
          <div
            key={r.rating}
            className="flex flex-col items-center rounded-xl bg-secondary/30 px-3 py-2"
          >
            <span className="text-3xl leading-none">{r.emoji}</span>
            <span className="mt-1 text-lg font-black tabular-nums">
              {counts[r.rating] ?? 0}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-right text-xs text-muted-foreground">
        {total} total
      </p>
    </div>
  );
}

function BubbleStack({
  bubbles,
  variant,
}: {
  bubbles: ChatMessage[];
  variant: 'overlay' | 'hero';
}) {
  const wrapperClass =
    variant === 'overlay'
      ? 'pointer-events-none fixed bottom-4 right-4 z-20 flex w-[min(460px,40vw)] flex-col items-end gap-2'
      : 'flex flex-col gap-2 rounded-2xl border border-border/40 bg-card/40 p-4 backdrop-blur';

  return (
    <div className={wrapperClass}>
      {variant === 'hero' && (
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Commentary
        </p>
      )}
      <AnimatePresence initial={false}>
        {bubbles.map((b) => {
          const kind = b.kind ?? 'scheduled';
          // Roast = fiery rose/orange; Celebrate = gold; Scheduled = speaker color.
          const isNala = b.speaker === 'nala';
          let colorClass: string;
          let prefix: string;
          if (kind === 'roast') {
            colorClass = 'border-eurorose-500/70 bg-eurorose-500/25 text-eurorose-50';
            prefix = '🔥 ';
          } else if (kind === 'celebrate') {
            colorClass = 'border-eurogold-400/70 bg-eurogold-500/25 text-eurogold-50';
            prefix = '🎉 ';
          } else {
            colorClass = isNala
              ? 'border-eurorose-500/50 bg-eurorose-500/20 text-eurorose-100'
              : 'border-europurp-500/50 bg-europurp-500/20 text-europurp-100';
            prefix = '';
          }
          return (
            <motion.div
              key={b.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className={`max-w-full rounded-2xl border px-4 py-3 shadow-lg backdrop-blur ${colorClass}`}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                {prefix}
                {b.speaker ?? 'commentator'}
                {kind !== 'scheduled' && ` · ${kind}`}
              </p>
              <p className="mt-1 text-sm font-medium leading-snug md:text-base">
                {b.content}
              </p>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {bubbles.length === 0 && variant === 'hero' && (
        <p className="text-sm text-muted-foreground">
          Nala &amp; Evee are warming up…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voting — "JURY IS DELIBERATING" + locked-in progress.
// ---------------------------------------------------------------------------

function VotingPhase({ partyId }: { partyId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [progress, setProgress] = useState({ locked: 0, total: 0 });

  // Compute "locked-in jurors" = distinct guest_ids in votes for this party.
  // total = number of guests in this party.
  const refresh = useMemo(
    () => async () => {
      if (!partyId) return;
      const guestsRes = await supabase
        .from('guests')
        .select('id')
        .eq('party_id', partyId);
      const ids = (guestsRes.data ?? []).map((g) => g.id);
      const votesRes =
        ids.length > 0
          ? await supabase
              .from('votes')
              .select('guest_id')
              .in('guest_id', ids)
          : { data: [] as { guest_id: string }[] };
      const distinct = new Set(
        (votesRes.data ?? []).map((v) => v.guest_id),
      ).size;
      setProgress({ locked: distinct, total: ids.length });
    },
    [supabase, partyId],
  );

  useEffect(() => {
    refresh();
    const chan = supabase
      .channel(`tv-voting:${partyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes' },
        () => refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'guests',
          filter: `party_id=eq.${partyId}`,
        },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(chan);
    };
  }, [supabase, partyId, refresh]);

  const pct =
    progress.total > 0
      ? Math.round((progress.locked / progress.total) * 100)
      : 0;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex min-h-screen flex-col items-center justify-center gap-10 px-8 text-center"
    >
      <motion.h1
        initial={{ scale: 0.9 }}
        animate={{ scale: [0.95, 1.02, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="bg-gradient-to-br from-eurorose-400 via-eurogold-400 to-europurp-400 bg-clip-text text-6xl font-black tracking-tight text-transparent md:text-8xl"
      >
        JURY IS DELIBERATING
      </motion.h1>
      <p className="text-lg text-muted-foreground md:text-xl">
        Phones out. Drag your top 10 into position.
      </p>

      <div className="w-full max-w-2xl">
        <div className="flex items-end justify-between">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Locked in
          </p>
          <p className="text-3xl font-black tabular-nums md:text-4xl">
            {progress.locked} / {progress.total}
          </p>
        </div>
        <div className="mt-2 h-4 w-full overflow-hidden rounded-full bg-secondary/30">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-eurorose-500 via-eurogold-400 to-europurp-500"
          />
        </div>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Closed — final standings: podium + full ranking + both leaderboards.
// ---------------------------------------------------------------------------

function ClosedPhase({
  partyId,
  actualResults,
}: {
  partyId: string;
  actualResults: ActualResultEntry[] | null;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [countriesByCode, setCountriesByCode] = useState<
    Record<string, Country>
  >({});
  const [guests, setGuests] = useState<Guest[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [sideBets, setSideBets] = useState<SideBet[]>([]);
  const [sideBetPicks, setSideBetPicks] = useState<SideBetPickRow[]>([]);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    (async () => {
      const countriesRes = await supabase.from('countries').select('*');
      const guestsRes = await supabase
        .from('guests')
        .select('*')
        .eq('party_id', partyId);
      const guestIds = (guestsRes.data ?? []).map((g) => g.id);
      const [votesRes, predsRes, picksRes, betsRes] = await Promise.all([
        guestIds.length > 0
          ? supabase.from('votes').select('*').in('guest_id', guestIds)
          : Promise.resolve({ data: [] as VoteRow[] }),
        guestIds.length > 0
          ? supabase
              .from('predictions')
              .select('*')
              .in('guest_id', guestIds)
          : Promise.resolve({ data: [] as Prediction[] }),
        guestIds.length > 0
          ? supabase
              .from('side_bet_picks')
              .select('*')
              .in('guest_id', guestIds)
          : Promise.resolve({ data: [] as SideBetPickRow[] }),
        supabase.from('side_bets').select('*').eq('party_id', partyId),
      ]);
      if (cancelled) return;
      const byCode: Record<string, Country> = {};
      for (const c of countriesRes.data ?? []) byCode[c.code] = c;
      setCountriesByCode(byCode);
      setGuests(guestsRes.data ?? []);
      setVotes((votesRes.data ?? []) as VoteRow[]);
      setPredictions((predsRes.data ?? []) as Prediction[]);
      setSideBetPicks((picksRes.data ?? []) as SideBetPickRow[]);
      setSideBets(betsRes.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, partyId]);

  const ranking = useMemo(
    () => tallyRoomResults(votes as unknown as Vote[]),
    [votes],
  );
  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);

  const predBoard = useMemo(
    () =>
      predictionLeaderboard(
        guests.map((g) => ({ id: g.id, display_name: g.display_name })),
        predictions.map((p) => ({
          guest_id: p.guest_id,
          country_code: p.country_code,
          position: p.position,
        })),
        actualResults,
      ),
    [guests, predictions, actualResults],
  );
  const sideBoard = useMemo(
    () =>
      sideBetLeaderboard(
        guests.map((g) => ({ id: g.id, display_name: g.display_name })),
        sideBets.map((b) => ({ id: b.id, resolved_value: b.resolved_value })),
        sideBetPicks.map((p) => ({
          guest_id: p.guest_id,
          bet_id: p.bet_id,
          pick: p.pick,
        })),
      ),
    [guests, sideBets, sideBetPicks],
  );

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-8 py-12"
    >
      <header className="text-center">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Eurojury · final standings
        </p>
        <h1 className="bg-gradient-to-br from-eurorose-400 via-eurogold-400 to-europurp-500 bg-clip-text text-5xl font-black tracking-tight text-transparent md:text-7xl">
          That&apos;s a wrap
        </h1>
      </header>

      {/* Podium */}
      <div className="grid grid-cols-3 items-end gap-4 md:gap-8">
        <PodiumStep
          rank={2}
          row={top3[1]}
          country={top3[1] ? countriesByCode[top3[1].country] : undefined}
          height="h-44"
        />
        <PodiumStep
          rank={1}
          row={top3[0]}
          country={top3[0] ? countriesByCode[top3[0].country] : undefined}
          height="h-60"
        />
        <PodiumStep
          rank={3}
          row={top3[2]}
          country={top3[2] ? countriesByCode[top3[2].country] : undefined}
          height="h-36"
        />
      </div>

      {/* Full ranking + leaderboards */}
      <div className="grid gap-6 md:grid-cols-3">
        <RankingCard
          title="Room ranking"
          rows={rest.map((r, i) => ({
            position: i + 4,
            label: countriesByCode[r.country]?.name ?? r.country,
            flag: countriesByCode[r.country]?.flag_emoji ?? '🏳️',
            value: `${r.points} pts`,
          }))}
        />
        <LeaderboardCard
          title="Predictions"
          subtitle="5 pts exact, 2 pts top-3"
          board={predBoard}
        />
        <LeaderboardCard
          title="Side bets"
          subtitle="1 pt per correct call"
          board={sideBoard}
        />
      </div>
    </motion.section>
  );
}

function PodiumStep({
  rank,
  row,
  country,
  height,
}: {
  rank: 1 | 2 | 3;
  row: { country: string; points: number } | undefined;
  country: Country | undefined;
  height: string;
}) {
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;
  const colors = {
    1: 'from-eurogold-400 to-eurogold-600 border-eurogold-400/60',
    2: 'from-slate-300 to-slate-500 border-slate-200/60',
    3: 'from-amber-700 to-amber-900 border-amber-500/60',
  } as const;
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.15, type: 'spring', stiffness: 100 }}
      className="flex flex-col items-center"
    >
      <div className="text-3xl md:text-4xl">{medal[rank]}</div>
      <div className="text-4xl md:text-6xl">{country?.flag_emoji ?? '🏳️'}</div>
      <p className="mt-1 text-center text-sm font-bold md:text-base">
        {country?.name ?? row?.country ?? '—'}
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        {row ? `${row.points} pts` : ''}
      </p>
      <div
        className={`w-full rounded-t-lg border bg-gradient-to-b ${colors[rank]} ${height}`}
      />
    </motion.div>
  );
}

function RankingCard({
  title,
  rows,
}: {
  title: string;
  rows: { position: number; label: string; flag: string; value: string }[];
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <ul className="mt-3 space-y-1">
        {rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">No further entries.</li>
        ) : (
          rows.map((r) => (
            <li
              key={`${r.position}-${r.label}`}
              className="flex items-center gap-3 rounded-md bg-secondary/30 px-3 py-1.5 text-sm"
            >
              <span className="w-7 text-right font-bold text-muted-foreground">
                #{r.position}
              </span>
              <span className="text-xl leading-none">{r.flag}</span>
              <span className="flex-1 truncate font-semibold">{r.label}</span>
              <span className="text-xs text-muted-foreground">{r.value}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function LeaderboardCard({
  title,
  subtitle,
  board,
}: {
  title: string;
  subtitle: string;
  board: GuestScore[];
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <p className="text-[10px] text-muted-foreground">{subtitle}</p>
      <ul className="mt-3 space-y-1">
        {board.length === 0 ? (
          <li className="text-sm text-muted-foreground">No entries.</li>
        ) : (
          board.map((row, i) => (
            <li
              key={row.guestId}
              className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-1.5 text-sm"
            >
              <span className="font-semibold">
                <span className="mr-2 text-muted-foreground">#{i + 1}</span>
                {row.displayName}
              </span>
              <span className="font-bold text-eurogold-400 tabular-nums">
                {row.score}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
