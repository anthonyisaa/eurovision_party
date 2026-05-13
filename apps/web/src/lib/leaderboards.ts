// Per-guest scoring rollups for the reveal leaderboards.
//
// Both functions are thin wrappers over the pure helpers in `scoring.ts`:
// they group raw rows by guest, hand each group to predictionScore /
// sideBetScore, and produce a sorted descending leaderboard. Tie-break is
// alphabetical on display_name so the order is deterministic for snapshot
// tests and on-screen re-renders.
//
// Keep this file dependency-free (no Supabase client, no React) so /reveal
// and /tv can both reuse it.

import { predictionScore, sideBetScore } from './scoring';
import type { Prediction, SideBet, SideBetPick } from './scoring';

export interface GuestLike {
  id: string;
  display_name: string;
}

export interface PredictionRow extends Prediction {
  guest_id: string;
}

export interface SideBetPickRow extends SideBetPick {
  guest_id: string;
}

export interface ActualResultRow {
  position: number;
  country_code: string;
}

export interface GuestScore {
  guestId: string;
  displayName: string;
  score: number;
}

function sortDescByScore(rows: GuestScore[]): GuestScore[] {
  return rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Score each guest's top-3 predictions against the actual top-3 finishers.
 * `actualResults` may be missing or in any order; we sort by position
 * ascending and feed the country codes to `predictionScore`.
 *
 * Guests with no predictions still appear in the output with score 0 so the
 * "everyone made the leaderboard" UX holds.
 */
export function predictionLeaderboard(
  guests: GuestLike[],
  predictions: PredictionRow[],
  actualResults: ActualResultRow[] | null | undefined,
): GuestScore[] {
  const ordered = [...(actualResults ?? [])].sort((a, b) => a.position - b.position);
  const actualCodes = ordered.map((r) => r.country_code);

  const byGuest = new Map<string, PredictionRow[]>();
  for (const p of predictions) {
    const arr = byGuest.get(p.guest_id) ?? [];
    arr.push(p);
    byGuest.set(p.guest_id, arr);
  }

  const rows: GuestScore[] = guests.map((g) => ({
    guestId: g.id,
    displayName: g.display_name,
    score: predictionScore(byGuest.get(g.id) ?? [], actualCodes),
  }));

  return sortDescByScore(rows);
}

/**
 * Score each guest's side-bet picks against the resolved bets.
 * Picks for unresolved bets contribute 0 (same as `sideBetScore`).
 */
export function sideBetLeaderboard(
  guests: GuestLike[],
  bets: SideBet[],
  picks: SideBetPickRow[],
): GuestScore[] {
  const byGuest = new Map<string, SideBetPickRow[]>();
  for (const p of picks) {
    const arr = byGuest.get(p.guest_id) ?? [];
    arr.push(p);
    byGuest.set(p.guest_id, arr);
  }

  const rows: GuestScore[] = guests.map((g) => ({
    guestId: g.id,
    displayName: g.display_name,
    score: sideBetScore(byGuest.get(g.id) ?? [], bets),
  }));

  return sortDescByScore(rows);
}
