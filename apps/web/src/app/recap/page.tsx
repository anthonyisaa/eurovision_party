'use client';

// /recap — post-show visualization comparing each guest's ballot against the
// official Eurovision 2026 final ranking.
//
// Standalone page (not gated by reveal_step / phase) so it can be loaded any
// time after the party. Reads `?party=` exactly like /tv.
//
// Scoring uses the Eurovision-native "alignment" metric from scoring.ts:
// for each of a guest's 10 votes, contribution = min(awarded, ideal), where
// ideal is what an Eurovision-clairvoyant juror would have awarded (1st→12,
// 2nd→10, … 10th→1, 11+→0). Max possible = 58 (a perfectly aligned ballot).
//
// The 2026 results are hardcoded in `eurovision-2026.ts` — no DB persistence
// yet. Swap that constant out (or thread it through props) for future years.

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { alignmentBreakdown, type AlignmentBreakdown } from '@/lib/scoring';
import {
  ALIGNMENT_MAX_SCORE,
  EUROVISION_2026_FINAL,
  EUROVISION_2026_WINNER,
  idealPointsFor,
  officialPosition,
} from '@/lib/eurovision-2026';
import type { Database } from '@eurojury/db/types';

type Country = Database['public']['Tables']['countries']['Row'];
type Guest = Database['public']['Tables']['guests']['Row'];
type VoteRow = Database['public']['Tables']['votes']['Row'];

interface GuestScored {
  guest: Guest;
  ballot: { country_code: string; points: number }[];
  breakdown: AlignmentBreakdown;
}

export default function RecapPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RecapPageInner />
    </Suspense>
  );
}

function LoadingFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-eurorose-950 p-6 text-center">
      <p className="text-sm text-muted-foreground">Loading recap…</p>
    </main>
  );
}

function RecapPageInner() {
  const search = useSearchParams();
  const partyId =
    search?.get('party') ?? process.env.NEXT_PUBLIC_PARTY_ID ?? '';

  const supabase = useMemo(() => supabaseBrowser(), []);
  const [countriesByCode, setCountriesByCode] = useState<Record<string, Country>>({});
  const [guests, setGuests] = useState<Guest[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!partyId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const [countriesRes, guestsRes] = await Promise.all([
        supabase.from('countries').select('*'),
        supabase.from('guests').select('*').eq('party_id', partyId),
      ]);
      const guestIds = (guestsRes.data ?? []).map((g) => g.id);
      const votesRes =
        guestIds.length > 0
          ? await supabase.from('votes').select('*').in('guest_id', guestIds)
          : { data: [] as VoteRow[] };

      if (cancelled) return;
      const byCode: Record<string, Country> = {};
      for (const c of countriesRes.data ?? []) byCode[c.code] = c;
      setCountriesByCode(byCode);
      setGuests(guestsRes.data ?? []);
      setVotes((votesRes.data ?? []) as VoteRow[]);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, partyId]);

  const scored: GuestScored[] = useMemo(() => {
    const byGuest = new Map<string, { country_code: string; points: number }[]>();
    for (const v of votes) {
      const arr = byGuest.get(v.guest_id) ?? [];
      arr.push({ country_code: v.country_code, points: v.points });
      byGuest.set(v.guest_id, arr);
    }
    const rows = guests.map((g) => {
      const ballot = byGuest.get(g.id) ?? [];
      const breakdown = alignmentBreakdown(ballot, idealPointsFor, officialPosition);
      return { guest: g, ballot, breakdown };
    });
    rows.sort((a, b) => {
      if (b.breakdown.score !== a.breakdown.score) {
        return b.breakdown.score - a.breakdown.score;
      }
      // Tiebreaker: more top-10 hits, then alphabetical.
      if (b.breakdown.topTenHits !== a.breakdown.topTenHits) {
        return b.breakdown.topTenHits - a.breakdown.topTenHits;
      }
      return a.guest.display_name.localeCompare(b.guest.display_name);
    });
    return rows;
  }, [guests, votes]);

  // Tightest fallbacks first.
  if (!partyId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <p className="text-sm text-destructive">
          No party id — pass ?party=… or set NEXT_PUBLIC_PARTY_ID.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-gradient-to-br from-background via-background to-eurorose-950 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
        <RecapHeader />

        {!loaded ? (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        ) : scored.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            No ballots cast for this party yet.
          </p>
        ) : (
          <>
            <Leaderboard scored={scored} />
            <BallotGrid scored={scored} countriesByCode={countriesByCode} />
            <OfficialRanking countriesByCode={countriesByCode} />
          </>
        )}

        <footer className="pt-4 text-center text-xs text-muted-foreground">
          <Link href={`/tv?party=${partyId}`} className="underline hover:text-foreground">
            ← back to /tv
          </Link>
        </footer>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Header — Bulgaria winner callout + framing.
// ---------------------------------------------------------------------------

function RecapHeader() {
  return (
    <header className="space-y-3 text-center">
      <p className="text-xs uppercase tracking-[0.4em] text-eurorose-400 md:text-sm">
        Eurojury recap · Eurovision 2026
      </p>
      <h1 className="bg-gradient-to-br from-eurorose-500 via-eurorose-300 to-eurogold-300 bg-clip-text text-4xl font-black tracking-tight text-transparent md:text-6xl">
        Who voted like Europe?
      </h1>
      <p className="mx-auto max-w-2xl text-sm text-muted-foreground md:text-base">
        Your top 10 vs the official Vienna result. Alignment is Eurovision&apos;s own
        scheme — closer your ballot is to the actual top 10 (in both picks
        <em> and</em> order), the more points you get back. Perfect score: 58.
      </p>
      <div className="mx-auto mt-4 inline-flex items-center gap-3 rounded-full border border-eurogold-400/50 bg-eurogold-500/15 px-5 py-2.5 text-sm shadow-lg shadow-eurogold-500/10 backdrop-blur md:gap-4 md:px-6 md:py-3 md:text-base">
        <span className="text-2xl md:text-3xl">🇧🇬</span>
        <div className="text-left leading-tight">
          <p className="text-[10px] uppercase tracking-widest text-eurogold-300 md:text-xs">
            Winner
          </p>
          <p className="font-bold">
            {EUROVISION_2026_WINNER.country_name} · {EUROVISION_2026_WINNER.artist} —{' '}
            <span className="italic">{EUROVISION_2026_WINNER.song}</span>
          </p>
        </div>
        <span className="text-base font-black text-eurogold-300 md:text-lg">
          {EUROVISION_2026_WINNER.total_points} pts
        </span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard — horizontal bars per guest, sorted by alignment score.
// ---------------------------------------------------------------------------

function Leaderboard({ scored }: { scored: GuestScored[] }) {
  const maxScore = ALIGNMENT_MAX_SCORE;
  return (
    <section className="rounded-3xl border border-border/40 bg-card/40 p-5 backdrop-blur md:p-8">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-2xl font-black md:text-3xl">Alignment leaderboard</h2>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          out of {maxScore}
        </p>
      </div>
      <ul className="space-y-3">
        {scored.map((row, i) => {
          const pct = (row.breakdown.score / maxScore) * 100;
          const medal = ['🥇', '🥈', '🥉'][i];
          const accent =
            i === 0
              ? 'from-eurogold-300 via-eurogold-400 to-eurogold-500'
              : i === 1
                ? 'from-slate-300 via-slate-400 to-slate-500'
                : i === 2
                  ? 'from-amber-500 via-amber-600 to-amber-700'
                  : 'from-eurorose-500 via-eurorose-400 to-europurp-400';
          return (
            <motion.li
              key={row.guest.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="space-y-1.5"
            >
              <div className="flex items-baseline justify-between gap-3 text-sm md:text-base">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
                    #{i + 1}
                  </span>
                  {medal && <span className="text-lg leading-none">{medal}</span>}
                  <span className="truncate font-bold">{row.guest.display_name}</span>
                  <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
                    · {row.breakdown.topTenHits}/10 in actual top 10
                  </span>
                </div>
                <div className="shrink-0 tabular-nums">
                  <span className="text-lg font-black md:text-xl">
                    {row.breakdown.score}
                  </span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    / {maxScore}
                  </span>
                </div>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-secondary/40">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 + i * 0.06 }}
                  className={`h-full bg-gradient-to-r ${accent}`}
                />
              </div>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ballot grid — one card per guest showing their 10 votes against the official
// position. Reveals where each guest "agreed with Europe" vs "marched to their
// own beat".
// ---------------------------------------------------------------------------

function BallotGrid({
  scored,
  countriesByCode,
}: {
  scored: GuestScored[];
  countriesByCode: Record<string, Country>;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-black md:text-3xl">Ballot breakdowns</h2>
      <p className="-mt-2 text-sm text-muted-foreground">
        Each guest&apos;s 10 picks alongside how that country actually finished.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {scored.map((row, i) => (
          <BallotCard
            key={row.guest.id}
            rank={i + 1}
            row={row}
            countriesByCode={countriesByCode}
          />
        ))}
      </div>
    </section>
  );
}

function BallotCard({
  rank,
  row,
  countriesByCode,
}: {
  rank: number;
  row: GuestScored;
  countriesByCode: Record<string, Country>;
}) {
  const [expanded, setExpanded] = useState(rank <= 3);
  const hits = row.breakdown.topTenHits;
  const hint =
    hits >= 8
      ? 'Eurovision oracle.'
      : hits >= 5
        ? 'Solid agreement.'
        : hits >= 3
          ? 'Found some Europe energy.'
          : 'Marched to your own beat.';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.04 }}
      className="rounded-2xl border border-border/40 bg-card/50 p-4 backdrop-blur md:p-5"
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            #{rank} · {hint}
          </p>
          <p className="truncate text-lg font-black md:text-xl">
            {row.guest.display_name}
          </p>
        </div>
        <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-black md:text-3xl">
            {row.breakdown.score}
          </span>
          <span className="text-xs text-muted-foreground">
            / {ALIGNMENT_MAX_SCORE}
          </span>
          <span aria-hidden className="ml-1 text-xs text-muted-foreground">
            {expanded ? '▴' : '▾'}
          </span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ol
            key="lines"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-3 space-y-1 overflow-hidden"
          >
            {row.breakdown.lines.length === 0 ? (
              <li className="rounded-md bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
                No ballot submitted.
              </li>
            ) : (
              row.breakdown.lines.map((line) => (
                <BallotLine
                  key={line.country_code}
                  line={line}
                  country={countriesByCode[line.country_code]}
                />
              ))
            )}
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function BallotLine({
  line,
  country,
}: {
  line: AlignmentBreakdown['lines'][number];
  country: Country | undefined;
}) {
  // Three tones:
  //  - bullseye  → guest's points exactly equal the ideal (right country at right rank)
  //  - in-top-10 → contributed something but not exact
  //  - miss      → contributed zero (country finished 11+ or didn't chart)
  const tone: 'bullseye' | 'topten' | 'miss' =
    line.ideal_points > 0 && line.guest_points === line.ideal_points
      ? 'bullseye'
      : line.contribution > 0
        ? 'topten'
        : 'miss';
  const toneClass = {
    bullseye:
      'border-eurogold-400/60 bg-gradient-to-r from-eurogold-500/25 to-eurogold-500/5',
    topten:
      'border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 to-emerald-500/5',
    miss: 'border-border/40 bg-secondary/20 text-muted-foreground',
  }[tone];
  const positionLabel =
    line.official_position == null
      ? 'didn’t chart'
      : `actual #${line.official_position}`;
  return (
    <li
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition ${toneClass}`}
    >
      <span className="w-9 shrink-0 text-right font-black tabular-nums">
        {line.guest_points}
      </span>
      <span className="text-xl leading-none">{country?.flag_emoji ?? '🏳️'}</span>
      <span className="min-w-0 flex-1 truncate font-semibold">
        {country?.name ?? line.country_code}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {positionLabel}
      </span>
      <span
        className={`w-12 shrink-0 text-right text-xs font-bold tabular-nums ${
          tone === 'miss' ? 'text-muted-foreground' : 'text-eurogold-300'
        }`}
      >
        {tone === 'bullseye' ? '🎯 ' : ''}
        +{line.contribution}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Official ranking — small reference block so guests can see the actual top
// 10 alongside their own results without leaving the page.
// ---------------------------------------------------------------------------

function OfficialRanking({
  countriesByCode,
}: {
  countriesByCode: Record<string, Country>;
}) {
  const topTen = EUROVISION_2026_FINAL.slice(0, 10);
  return (
    <section className="rounded-3xl border border-border/40 bg-card/40 p-5 backdrop-blur md:p-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-2xl font-black md:text-3xl">Official top 10</h2>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Vienna 2026
        </p>
      </div>
      <ol className="grid gap-1.5 md:grid-cols-2">
        {topTen.map((r) => {
          const fallbackFlag = countriesByCode[r.country_code]?.flag_emoji;
          return (
            <li
              key={r.country_code}
              className="flex items-center gap-3 rounded-md bg-secondary/30 px-3 py-2 text-sm"
            >
              <span className="w-7 text-right font-black tabular-nums text-eurogold-300">
                {r.position}
              </span>
              <span className="text-xl leading-none">{fallbackFlag ?? '🏳️'}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {r.country_name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {r.artist}
              </span>
              <span className="w-12 shrink-0 text-right text-xs font-bold tabular-nums text-eurogold-300">
                {r.total != null ? `${r.total} pts` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
