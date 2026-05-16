'use client';

// RevealStage — the TV-sized, animated 10-step reveal sequence.
//
// Drives entirely off `revealStep` (0..10, set by the host from /admin).
// Steps render via a switch; each step is its own subcomponent in this file
// so they can share styling, framer-motion variants, and the audio refs.
//
// Reused by:
//   - /reveal/page.tsx when the form factor is desktop/TV
//   - /tv/page.tsx during the reveal phase (Agent E)
//
// Data: subscribes to votes, predictions, side_bets, side_bet_picks, guests
// for the party. None of these change after the reveal starts (votes are
// locked, predictions are locked), but we use the same one-shot fetch +
// realtime upsert pattern as /admin so a late vote/correction still flows
// through. The expensive bits (leaderboards, top-N) are memoised.
//
// Sound: four placeholder <audio> elements live at the bottom. Each step
// component grabs the relevant ref and tries to play() — silently fails if
// the file is missing, which is fine for now.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { tallyRoomResults, type Vote } from '@/lib/scoring';
import {
  predictionLeaderboard,
  sideBetLeaderboard,
  type GuestScore,
} from '@/lib/leaderboards';
import { MuteToggle, useRevealMuted } from './MuteToggle';
import type { Database } from '@eurojury/db/types';

type Country = Database['public']['Tables']['countries']['Row'];
type Guest = Database['public']['Tables']['guests']['Row'];
type VoteRow = Database['public']['Tables']['votes']['Row'];
type Prediction = Database['public']['Tables']['predictions']['Row'];
type SideBet = Database['public']['Tables']['side_bets']['Row'];
type SideBetPick = Database['public']['Tables']['side_bet_picks']['Row'];
type ScheduledCommentary =
  Database['public']['Tables']['scheduled_commentary']['Row'];

interface ActualResultEntry {
  position: number;
  country_code: string;
}

export interface RevealStageProps {
  partyId: string;
  revealStep: number;
  actualResults?: ActualResultEntry[] | null;
}

// ---------------------------------------------------------------------------
// Sound effect refs — kept as a single typed handle so steps can fire by name.
// ---------------------------------------------------------------------------

interface SoundBank {
  boo: HTMLAudioElement | null;
  drumroll: HTMLAudioElement | null;
  ding: HTMLAudioElement | null;
  fanfare: HTMLAudioElement | null;
}

function useSound(bank: React.MutableRefObject<SoundBank>, muted: boolean) {
  return useCallback(
    (name: keyof SoundBank) => {
      if (muted) return;
      const el = bank.current[name];
      if (!el) return;
      try {
        el.currentTime = 0;
        // .play() returns a promise — we explicitly ignore rejections so
        // missing-file 404s / autoplay-policy errors don't bubble.
        void el.play().catch(() => undefined);
      } catch {
        /* ignore */
      }
    },
    [bank, muted],
  );
}

// ---------------------------------------------------------------------------
// Data fetching — pulls everything needed for steps 2..9 once and keeps it in
// sync with realtime UPDATE/INSERTs. Step subcomponents read the resulting
// memoised arrays via props.
// ---------------------------------------------------------------------------

interface RevealData {
  votes: VoteRow[];
  guests: Guest[];
  predictions: Prediction[];
  sideBets: SideBet[];
  sideBetPicks: SideBetPick[];
  countries: Record<string, Country>;
  outroLines: ScheduledCommentary[];
  loaded: boolean;
}

function useRevealData(partyId: string): RevealData {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [sideBets, setSideBets] = useState<SideBet[]>([]);
  const [sideBetPicks, setSideBetPicks] = useState<SideBetPick[]>([]);
  const [countries, setCountries] = useState<Record<string, Country>>({});
  const [outroLines, setOutroLines] = useState<ScheduledCommentary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    (async () => {
      // The reveal page is read-heavy and runs anonymously; service role
      // not needed because all these tables are world-readable.
      const countriesRes = await supabase.from('countries').select('*');
      const guestsRes = await supabase
        .from('guests')
        .select('*')
        .eq('party_id', partyId);
      const guestIds = (guestsRes.data ?? []).map((g) => g.id);

      // Votes/predictions/picks are scoped by guest_id (no party_id column),
      // so we filter via the party's guest list.
      const [votesRes, predsRes, picksRes, betsRes, outroRes] =
        await Promise.all([
          guestIds.length > 0
            ? supabase.from('votes').select('*').in('guest_id', guestIds)
            : Promise.resolve({ data: [] as VoteRow[] }),
          guestIds.length > 0
            ? supabase.from('predictions').select('*').in('guest_id', guestIds)
            : Promise.resolve({ data: [] as Prediction[] }),
          guestIds.length > 0
            ? supabase
                .from('side_bet_picks')
                .select('*')
                .in('guest_id', guestIds)
            : Promise.resolve({ data: [] as SideBetPick[] }),
          supabase.from('side_bets').select('*').eq('party_id', partyId),
          supabase
            .from('scheduled_commentary')
            .select('*')
            .eq('party_id', partyId)
            .eq('category', 'roast')
            .eq('fired', false)
            .order('id', { ascending: true })
            .limit(2),
        ]);

      if (cancelled) return;
      const byCode: Record<string, Country> = {};
      for (const c of countriesRes.data ?? []) byCode[c.code] = c;
      setCountries(byCode);
      setGuests(guestsRes.data ?? []);
      setVotes((votesRes.data ?? []) as VoteRow[]);
      setPredictions((predsRes.data ?? []) as Prediction[]);
      setSideBetPicks((picksRes.data ?? []) as SideBetPick[]);
      setSideBets(betsRes.data ?? []);
      setOutroLines((outroRes.data ?? []) as ScheduledCommentary[]);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, partyId]);

  return {
    votes,
    guests,
    predictions,
    sideBets,
    sideBetPicks,
    countries,
    outroLines,
    loaded,
  };
}

// ---------------------------------------------------------------------------
// Main component.
// ---------------------------------------------------------------------------

export function RevealStage({
  partyId,
  revealStep,
  actualResults,
}: RevealStageProps) {
  const { muted, setMuted } = useRevealMuted();
  const data = useRevealData(partyId);
  const soundsRef = useRef<SoundBank>({
    boo: null,
    drumroll: null,
    ding: null,
    fanfare: null,
  });
  const play = useSound(soundsRef, muted);

  // Pre-compute the room ranking — used by steps 2..6.
  const ranking = useMemo(() => {
    return tallyRoomResults(data.votes as Vote[]);
  }, [data.votes]);

  // Lookup helper used by every step.
  const lookupCountry = useCallback(
    (code: string | null | undefined): Country | undefined => {
      if (!code) return undefined;
      return data.countries[code];
    },
    [data.countries],
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-background via-background to-eurorose-950 text-foreground">
      <MuteToggle muted={muted} onChange={setMuted} />

      <div className="absolute inset-0 flex items-center justify-center px-8 py-12">
        <AnimatePresence mode="wait">
          {revealStep === 0 && <Step0Idle key="step0" />}
          {revealStep === 1 && <Step1Title key="step1" />}
          {revealStep === 2 && (
            <Step2BottomFive
              key="step2"
              ranking={ranking}
              lookupCountry={lookupCountry}
              play={play}
            />
          )}
          {revealStep === 3 && (
            <Step3MidPack
              key="step3"
              ranking={ranking}
              lookupCountry={lookupCountry}
            />
          )}
          {revealStep === 4 && (
            <Step4TopFive
              key="step4"
              ranking={ranking}
              lookupCountry={lookupCountry}
              play={play}
            />
          )}
          {revealStep === 5 && (
            <Step5Winner
              key="step5"
              ranking={ranking}
              lookupCountry={lookupCountry}
              play={play}
            />
          )}
          {revealStep === 6 && (
            <Step6Comparison
              key="step6"
              ranking={ranking}
              actualResults={actualResults ?? null}
              lookupCountry={lookupCountry}
            />
          )}
          {revealStep === 7 && (
            <Step7Predictions
              key="step7"
              guests={data.guests}
              predictions={data.predictions}
              actualResults={actualResults ?? null}
            />
          )}
          {revealStep === 8 && (
            <Step8SideBets
              key="step8"
              guests={data.guests}
              bets={data.sideBets}
              picks={data.sideBetPicks}
            />
          )}
          {revealStep === 9 && (
            <Step9GuestSummary
              key="step9"
              guests={data.guests}
              votes={data.votes}
              ranking={ranking}
              actualResults={actualResults ?? null}
              lookupCountry={lookupCountry}
            />
          )}
          {revealStep === 10 && (
            <Step10Closing key="step10" outroLines={data.outroLines} />
          )}
          {revealStep > 10 && <Step10Closing key="stepClosed" outroLines={data.outroLines} />}
        </AnimatePresence>
      </div>

      {/* Hidden audio elements — files live in /public/sounds. Missing files
         silently 404 and play() rejects (which we swallow above). */}
      <audio
        ref={(el) => {
          soundsRef.current.boo = el;
        }}
        src="/sounds/boo.mp3"
        preload="auto"
      />
      <audio
        ref={(el) => {
          soundsRef.current.drumroll = el;
        }}
        src="/sounds/drumroll.mp3"
        preload="auto"
      />
      <audio
        ref={(el) => {
          soundsRef.current.ding = el;
        }}
        src="/sounds/ding.mp3"
        preload="auto"
      />
      <audio
        ref={(el) => {
          soundsRef.current.fanfare = el;
        }}
        src="/sounds/fanfare.mp3"
        preload="auto"
      />

      {!data.loaded && (
        <div className="absolute bottom-6 left-6 text-xs text-muted-foreground">
          Loading reveal data…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — Idle (host hasn't started the reveal yet)
// ---------------------------------------------------------------------------

function Step0Idle() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="text-center"
    >
      <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">
        Reveal stage
      </p>
      <h1 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
        Standing by…
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Host will trigger the reveal from /admin.
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Title card
// ---------------------------------------------------------------------------

function Step1Title() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.6 }}
      className="text-center"
    >
      <motion.h1
        initial={{ backgroundPosition: '0% 50%' }}
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        style={{
          backgroundImage:
            'linear-gradient(90deg, #f472b6, #facc15, #a78bfa, #f472b6)',
          backgroundSize: '300% 100%',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
        className="text-6xl font-black tracking-tight md:text-8xl"
      >
        Tonight&apos;s results
      </motion.h1>
      <p className="mt-6 text-5xl">🇪🇺</p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PositionedRow {
  position: number; // 1..N
  country: string;
  points: number;
}

function rankToPositions(rows: { country: string; points: number }[]): PositionedRow[] {
  return rows.map((r, i) => ({ position: i + 1, country: r.country, points: r.points }));
}

function FlagBlock({
  country,
  size = 'md',
}: {
  country?: { name: string; flag_emoji: string };
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const cls = {
    sm: 'text-3xl',
    md: 'text-5xl',
    lg: 'text-7xl',
    xl: 'text-[10rem]',
  }[size];
  return <span className={`leading-none ${cls}`}>{country?.flag_emoji ?? '🏳️'}</span>;
}

// ---------------------------------------------------------------------------
// Step 2 — Bottom 5 (positions 22..26 of 26)
// ---------------------------------------------------------------------------

function Step2BottomFive({
  ranking,
  lookupCountry,
  play,
}: {
  ranking: { country: string; points: number }[];
  lookupCountry: (code: string) => Country | undefined;
  play: (n: 'boo' | 'drumroll' | 'ding' | 'fanfare') => void;
}) {
  const positioned = rankToPositions(ranking);
  // Show "bottom 5" — by definition the last 5 of the room ranking. If we
  // have fewer than 5 entries this still shows what's there.
  const bottom = positioned.slice(-5).reverse(); // 26, 25, 24, 23, 22

  useEffect(() => {
    play('boo');
  }, [play]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-3xl space-y-6"
    >
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-eurorose-300">
          Booooo
        </p>
        <h2 className="text-4xl font-black md:text-5xl">Bottom 5</h2>
      </div>
      <div className="space-y-2">
        {bottom.map((row, i) => {
          const country = lookupCountry(row.country);
          return (
            <motion.div
              key={row.country}
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.6, type: 'spring', stiffness: 120 }}
              className="flex items-center gap-4 rounded-xl border border-eurorose-700/30 bg-card/40 p-4 backdrop-blur"
            >
              <div className="w-12 text-center text-2xl font-black text-eurorose-300">
                #{row.position}
              </div>
              <FlagBlock country={country} size="md" />
              <div className="flex-1">
                <p className="text-xl font-bold">{country?.name ?? row.country}</p>
                {country?.artist && (
                  <p className="text-sm text-muted-foreground">
                    {country.artist}
                  </p>
                )}
              </div>
              <div className="text-2xl font-black text-muted-foreground">
                {row.points} pts
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Mid-pack scroll (positions 21 → 6)
// ---------------------------------------------------------------------------

function Step3MidPack({
  ranking,
  lookupCountry,
}: {
  ranking: { country: string; points: number }[];
  lookupCountry: (code: string) => Country | undefined;
}) {
  const positioned = rankToPositions(ranking);
  // "Mid pack" — drop the bottom 5 and the top 5, leaving 6..N-5 in
  // best-to-worst order; we reverse for the scroll-of-shame so it ticks
  // from #21 down to #6 visually.
  const total = positioned.length;
  const top5End = 5;
  const bottom5Start = Math.max(top5End, total - 5);
  const mid = positioned.slice(top5End, bottom5Start).reverse(); // 21..6

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-2xl text-center"
    >
      <p className="text-sm uppercase tracking-widest text-europurp-300">
        Scroll of shame
      </p>
      <h2 className="text-4xl font-black md:text-5xl">Mid-pack</h2>
      <div className="relative mt-8 h-96 overflow-hidden rounded-2xl border border-border/40 bg-card/30 backdrop-blur">
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: '-100%' }}
          transition={{ duration: 7, ease: 'linear' }}
          className="absolute inset-x-0 space-y-3 px-6 py-4"
        >
          {mid.map((row) => {
            const country = lookupCountry(row.country);
            return (
              <div
                key={row.country}
                className="flex items-center gap-4 rounded-lg bg-secondary/30 px-4 py-2 text-left"
              >
                <span className="w-10 text-lg font-bold text-eurogold-400">
                  #{row.position}
                </span>
                <span className="text-3xl">{country?.flag_emoji ?? '🏳️'}</span>
                <span className="flex-1 truncate text-lg font-semibold">
                  {country?.name ?? row.country}
                </span>
                <span className="text-base text-muted-foreground">
                  {row.points} pts
                </span>
              </div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Top 5 reveal (positions 5, 4, 3, 2; the winner is held back for
// step 5). Self-paces over ~15s.
// ---------------------------------------------------------------------------

function Step4TopFive({
  ranking,
  lookupCountry,
  play,
}: {
  ranking: { country: string; points: number }[];
  lookupCountry: (code: string) => Country | undefined;
  play: (n: 'boo' | 'drumroll' | 'ding' | 'fanfare') => void;
}) {
  const positioned = rankToPositions(ranking);
  // Take positions 2..5 (indexes 1..4), reverse so we reveal #5 first.
  const subset = positioned.slice(1, 5).reverse(); // 5, 4, 3, 2
  const [subIdx, setSubIdx] = useState(0);

  useEffect(() => {
    // Advance one sub-reveal every ~3.5s.
    if (subIdx >= subset.length) return;
    play('drumroll');
    const id = setTimeout(() => setSubIdx((i) => i + 1), 3500);
    return () => clearTimeout(id);
  }, [subIdx, subset.length, play]);

  const visible = subset.slice(0, subIdx + 1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-3xl text-center"
    >
      <p className="text-sm uppercase tracking-widest text-eurogold-400">
        Drumroll please…
      </p>
      <h2 className="text-4xl font-black md:text-5xl">Top 5</h2>
      <div className="mt-8 space-y-3">
        {visible.map((row) => {
          const country = lookupCountry(row.country);
          return (
            <motion.div
              key={row.country}
              initial={{ opacity: 0, scale: 0.7, rotateX: 90 }}
              animate={{ opacity: 1, scale: 1, rotateX: 0 }}
              transition={{ type: 'spring', stiffness: 90, damping: 12 }}
              className="flex items-center gap-5 rounded-2xl border border-eurogold-500/40 bg-gradient-to-r from-card/60 to-eurogold-500/10 p-5 backdrop-blur"
            >
              <div className="text-5xl font-black text-eurogold-400">
                #{row.position}
              </div>
              <FlagBlock country={country} size="lg" />
              <div className="flex-1 text-left">
                <p className="text-2xl font-bold">{country?.name ?? row.country}</p>
                {country?.song_title && (
                  <p className="text-sm italic text-eurorose-300">
                    &ldquo;{country.song_title}&rdquo;
                    {country.artist && ` — ${country.artist}`}
                  </p>
                )}
              </div>
              <div className="text-3xl font-black">{row.points}</div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Winner announcement (position 1)
// ---------------------------------------------------------------------------

function Step5Winner({
  ranking,
  lookupCountry,
  play,
}: {
  ranking: { country: string; points: number }[];
  lookupCountry: (code: string) => Country | undefined;
  play: (n: 'boo' | 'drumroll' | 'ding' | 'fanfare') => void;
}) {
  const winner = ranking[0];
  const country = winner ? lookupCountry(winner.country) : undefined;

  useEffect(() => {
    play('fanfare');
    // Two confetti bursts from the bottom corners, then a centre burst.
    const fire = (originX: number) =>
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { x: originX, y: 1 },
        startVelocity: 55,
        colors: ['#f472b6', '#facc15', '#a78bfa', '#22d3ee'],
      });
    fire(0.1);
    fire(0.9);
    const ids = [
      setTimeout(() => fire(0.2), 600),
      setTimeout(() => fire(0.8), 800),
      setTimeout(
        () =>
          confetti({
            particleCount: 200,
            spread: 160,
            origin: { x: 0.5, y: 0.5 },
            startVelocity: 35,
          }),
        1400,
      ),
    ];
    return () => {
      ids.forEach((id) => clearTimeout(id));
    };
  }, [play]);

  if (!winner) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="text-center"
      >
        <h2 className="text-3xl font-black">No votes cast — no winner.</h2>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 80, damping: 14 }}
      className="text-center"
    >
      <p className="text-base uppercase tracking-[0.3em] text-eurogold-400 md:text-lg">
        Room 12 points go to…
      </p>
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.3, 1] }}
        transition={{ duration: 0.8 }}
        className="mt-4"
      >
        <FlagBlock country={country} size="xl" />
      </motion.div>
      <h1 className="mt-4 text-6xl font-black tracking-tight md:text-8xl">
        {country?.name ?? winner.country}
      </h1>
      {country?.song_title && (
        <p className="mt-3 text-xl italic text-eurorose-300 md:text-2xl">
          &ldquo;{country.song_title}&rdquo;
        </p>
      )}
      {country?.artist && (
        <p className="text-base text-muted-foreground md:text-lg">
          — {country.artist}
        </p>
      )}
      <p className="mt-6 text-3xl font-black text-eurogold-400 md:text-4xl">
        {winner.points} points
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Room vs Real comparison
// ---------------------------------------------------------------------------

function Step6Comparison({
  ranking,
  actualResults,
  lookupCountry,
}: {
  ranking: { country: string; points: number }[];
  actualResults: ActualResultEntry[] | null;
  lookupCountry: (code: string) => Country | undefined;
}) {
  const roomTop = ranking.slice(0, 5);
  const realTop = useMemo(() => {
    if (!actualResults) return null;
    return [...actualResults]
      .sort((a, b) => a.position - b.position)
      .slice(0, 5);
  }, [actualResults]);

  if (!realTop) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="max-w-xl text-center"
      >
        <h2 className="text-3xl font-black">No real results yet</h2>
        <p className="mt-4 text-base text-muted-foreground">
          The host hasn&apos;t pasted Eurovision&apos;s actual top-5 into
          /admin/setup. They can do that at any time — refresh this screen
          afterwards to see the comparison.
        </p>
      </motion.div>
    );
  }

  const realCodes = new Set(realTop.map((r) => r.country_code));
  const roomCodes = new Set(roomTop.map((r) => r.country));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-5xl"
    >
      <div className="text-center">
        <h2 className="text-3xl font-black md:text-4xl">Room vs Real</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Matches in <span className="text-emerald-400">green</span>, misses in
          subtle red.
        </p>
      </div>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <ComparisonColumn
          label="Room"
          rows={roomTop.map((r, i) => ({ position: i + 1, country: r.country }))}
          otherSet={realCodes}
          lookupCountry={lookupCountry}
        />
        <ComparisonColumn
          label="Real"
          rows={realTop.map((r) => ({ position: r.position, country: r.country_code }))}
          otherSet={roomCodes}
          lookupCountry={lookupCountry}
        />
      </div>
    </motion.div>
  );
}

function ComparisonColumn({
  label,
  rows,
  otherSet,
  lookupCountry,
}: {
  label: string;
  rows: { position: number; country: string }[];
  otherSet: Set<string>;
  lookupCountry: (code: string) => Country | undefined;
}) {
  return (
    <div className="space-y-2">
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {rows.map((row, i) => {
        const country = lookupCountry(row.country);
        const matched = otherSet.has(row.country);
        return (
          <motion.div
            key={`${label}-${row.country}`}
            initial={{ opacity: 0, x: label === 'Room' ? -20 : 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              matched
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-eurorose-600/30 bg-eurorose-500/5'
            }`}
          >
            <span className="w-8 text-center font-black">#{row.position}</span>
            <span className="text-3xl">{country?.flag_emoji ?? '🏳️'}</span>
            <span className="flex-1 font-semibold">
              {country?.name ?? row.country}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 7 — Predictions leaderboard
// ---------------------------------------------------------------------------

function Step7Predictions({
  guests,
  predictions,
  actualResults,
}: {
  guests: Guest[];
  predictions: Prediction[];
  actualResults: ActualResultEntry[] | null;
}) {
  const board = useMemo(
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
  return (
    <LeaderboardLayout title="Predictions leaderboard" subtitle="5 pts exact, 2 pts in-top-3" board={board} />
  );
}

// ---------------------------------------------------------------------------
// Step 8 — Side bets leaderboard
// ---------------------------------------------------------------------------

function Step8SideBets({
  guests,
  bets,
  picks,
}: {
  guests: Guest[];
  bets: SideBet[];
  picks: SideBetPick[];
}) {
  const board = useMemo(
    () =>
      sideBetLeaderboard(
        guests.map((g) => ({ id: g.id, display_name: g.display_name })),
        bets.map((b) => ({ id: b.id, resolved_value: b.resolved_value })),
        picks.map((p) => ({
          guest_id: p.guest_id,
          bet_id: p.bet_id,
          pick: p.pick,
        })),
      ),
    [guests, bets, picks],
  );
  return (
    <LeaderboardLayout
      title="Side bets leaderboard"
      subtitle="1 pt per correct call"
      board={board}
    />
  );
}

// Shared layout used by steps 7 & 8.
function LeaderboardLayout({
  title,
  subtitle,
  board,
}: {
  title: string;
  subtitle: string;
  board: GuestScore[];
}) {
  const podium = board.slice(0, 3);
  const rest = board.slice(3);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-4xl"
    >
      <div className="text-center">
        <h2 className="text-4xl font-black md:text-5xl">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="mt-10 grid grid-cols-3 items-end gap-3 md:gap-6">
        {/* The podium order on screen: 2nd, 1st (tallest), 3rd. */}
        <PodiumPillar place={2} entry={podium[1]} height="h-40" />
        <PodiumPillar place={1} entry={podium[0]} height="h-56" />
        <PodiumPillar place={3} entry={podium[2]} height="h-32" />
      </div>

      {rest.length > 0 && (
        <div className="mt-10 mx-auto max-w-md space-y-1">
          {rest.map((row, i) => (
            <motion.div
              key={row.guestId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.05 }}
              className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2"
            >
              <span className="text-sm font-semibold">
                #{i + 4} {row.displayName}
              </span>
              <span className="text-sm text-muted-foreground">
                {row.score} pts
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function PodiumPillar({
  place,
  entry,
  height,
}: {
  place: 1 | 2 | 3;
  entry: GuestScore | undefined;
  height: string;
}) {
  const colors = {
    1: 'from-eurogold-400 to-eurogold-600 border-eurogold-300/60',
    2: 'from-slate-300 to-slate-500 border-slate-200/60',
    3: 'from-amber-700 to-amber-900 border-amber-500/60',
  } as const;
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: place * 0.15, type: 'spring', stiffness: 100 }}
      className="flex flex-col items-center"
    >
      <div className="text-3xl">{medal[place]}</div>
      <div className="mt-1 text-center text-sm font-bold md:text-base">
        {entry?.displayName ?? '—'}
      </div>
      <div className="mb-2 text-xs text-muted-foreground">
        {entry ? `${entry.score} pts` : ''}
      </div>
      <div
        className={`w-full rounded-t-lg border bg-gradient-to-b ${colors[place]} ${height}`}
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 9 — Per-guest summary cycle. Auto-rotates every 5s.
// ---------------------------------------------------------------------------

function Step9GuestSummary({
  guests,
  votes,
  ranking,
  actualResults,
  lookupCountry,
}: {
  guests: Guest[];
  votes: VoteRow[];
  ranking: { country: string; points: number }[];
  actualResults: ActualResultEntry[] | null;
  lookupCountry: (code: string) => Country | undefined;
}) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (guests.length === 0) return;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % guests.length);
    }, 5000);
    return () => clearInterval(id);
  }, [guests.length]);

  if (guests.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center"
      >
        <h2 className="text-3xl font-black">No guests on record.</h2>
      </motion.div>
    );
  }

  const guest = guests[idx];
  if (!guest) return null;

  // Build the tagline algorithmically.
  const myVotes = votes
    .filter((v) => v.guest_id === guest.id)
    .sort((a, b) => b.points - a.points);
  const top3 = myVotes.slice(0, 3);

  const roomPos = (code: string) =>
    ranking.findIndex((r) => r.country === code) + 1 || null;
  const realPos = (code: string) =>
    actualResults?.find((r) => r.country_code === code)?.position ?? null;

  const team = [guest.assigned_country_1, guest.assigned_country_2].filter(
    (c): c is string => Boolean(c),
  );

  // Tagline rules — first matching rule wins.
  let tagline = 'Played it cool tonight.';
  if (top3.length === 0) {
    tagline = 'Didn’t cast a vote — bold strategy.';
  } else if (top3.length > 0) {
    const topVote = top3[0]!;
    const room = roomPos(topVote.country_code);
    const real = realPos(topVote.country_code);
    const country = lookupCountry(topVote.country_code);
    const flag = country?.flag_emoji ?? '🏳️';
    const name = country?.name ?? topVote.country_code;
    if (room && room <= 3 && real && real <= 3) {
      tagline = `Aligned with the room AND the real result on ${name} ${flag}`;
    } else if (room && room <= 5) {
      tagline = `${name} ${flag} defender — backed the room favourite.`;
    } else if (real && real <= 5) {
      tagline = `${name} ${flag} — you saw what Europe saw.`;
    } else {
      tagline = `Marched to your own beat with ${name} ${flag}.`;
    }
  }

  return (
    <motion.div
      key={guest.id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-2xl text-center"
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        Guest {idx + 1} of {guests.length}
      </p>
      <h2 className="mt-2 text-5xl font-black md:text-6xl">{guest.display_name}</h2>
      {team.length > 0 && (
        <div className="mt-4 flex justify-center gap-3 text-5xl">
          {team.map((code) => (
            <span key={code}>{lookupCountry(code)?.flag_emoji ?? '🏳️'}</span>
          ))}
        </div>
      )}
      <p className="mt-6 text-xl text-eurogold-300 md:text-2xl">{tagline}</p>
      {top3.length > 0 && (
        <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/40 bg-card/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">Your top:</span>
          {top3.map((v) => {
            const c = lookupCountry(v.country_code);
            return (
              <span key={v.country_code} className="font-semibold">
                {c?.flag_emoji ?? '🏳️'} {c?.name ?? v.country_code} ({v.points})
              </span>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 10 — Closing card
// ---------------------------------------------------------------------------

function Step10Closing({ outroLines }: { outroLines: ScheduledCommentary[] }) {
  // Pick the first two unused roast lines; if there aren't any, fall back to
  // generic outros so we never render an empty closing.
  const nala = outroLines.find((l) => l.speaker === 'nala') ?? outroLines[0];
  const evee =
    outroLines.find((l) => l.speaker === 'evee' && l.id !== nala?.id) ??
    outroLines[1];
  const nalaLine =
    nala?.content ?? 'Right, that was a circus. Bedtime.';
  const eveeLine =
    evee?.content ?? 'Mwah. Same time next year, darlings.';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8 }}
      className="w-full max-w-3xl text-center"
    >
      <h1 className="text-4xl font-black md:text-6xl">
        🐱 That&apos;s a wrap from Nala &amp; Evee.
      </h1>
      <p className="mt-2 text-base text-muted-foreground md:text-lg">
        Until next year.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <SpeechBubble who="Nala" tone="rose">
          {nalaLine}
        </SpeechBubble>
        <SpeechBubble who="Evee" tone="purple">
          {eveeLine}
        </SpeechBubble>
      </div>
    </motion.div>
  );
}

function SpeechBubble({
  who,
  tone,
  children,
}: {
  who: string;
  tone: 'rose' | 'purple';
  children: React.ReactNode;
}) {
  const color =
    tone === 'rose'
      ? 'border-eurorose-500/40 bg-eurorose-500/10'
      : 'border-europurp-500/40 bg-europurp-500/10';
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className={`rounded-2xl border p-5 text-left ${color}`}
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {who}
      </p>
      <p className="mt-2 text-base md:text-lg">{children}</p>
    </motion.div>
  );
}
