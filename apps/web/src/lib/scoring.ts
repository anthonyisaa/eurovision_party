// Pure scoring helpers. No DB, no React — keep this file dependency-free so
// the unit tests stay fast and the same logic can be reused on /tv and
// /reveal without dragging in Supabase clients.
//
// All three scoring rules are friend-party-tuned: dramatic enough to crown a
// winner, lenient enough that nobody walks away with zero.

export interface Vote {
  guest_id: string;
  country_code: string;
  points: number;
}

export interface ReactionLike {
  country_code: string;
  rating: number;
}

export interface Prediction {
  position: number; // 1, 2, or 3
  country_code: string;
}

export interface SideBet {
  id: string;
  resolved_value: string | null;
}

export interface SideBetPick {
  bet_id: string;
  pick: string;
}

export interface RoomResultRow {
  country: string;
  points: number;
}

/**
 * Sum points per country across all submitted votes, sort descending.
 * Tiebreakers (deterministic):
 *   1. Total reactions cast for the country (more reactions → higher rank).
 *   2. Country code ascending (alphabetical fallback).
 *
 * Caller can pass an empty `reactions` array if they don't have access; the
 * second tiebreaker still applies. The function never throws.
 */
export function tallyRoomResults(
  votes: Vote[],
  reactions: ReactionLike[] = [],
): RoomResultRow[] {
  const points = new Map<string, number>();
  for (const v of votes) {
    points.set(v.country_code, (points.get(v.country_code) ?? 0) + v.points);
  }

  const reactionTotals = new Map<string, number>();
  for (const r of reactions) {
    reactionTotals.set(
      r.country_code,
      (reactionTotals.get(r.country_code) ?? 0) + r.rating,
    );
  }

  const rows: RoomResultRow[] = Array.from(points.entries()).map(
    ([country, p]) => ({ country, points: p }),
  );

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const ra = reactionTotals.get(a.country) ?? 0;
    const rb = reactionTotals.get(b.country) ?? 0;
    if (rb !== ra) return rb - ra;
    return a.country < b.country ? -1 : a.country > b.country ? 1 : 0;
  });

  return rows;
}

/**
 * Prediction score for one guest.
 *   - 5 pts: predicted country is exactly at that position in actual top-3.
 *   - 2 pts: predicted country is in actual top-3 but at a different position.
 *   - 0 pts: predicted country is not in actual top-3.
 *
 * `predictions` may be a partial set (e.g. guest only filled position 1).
 * `actualResults` is the ordered actual finishing order (top-3 or longer).
 */
export function predictionScore(
  predictions: Prediction[],
  actualResults: string[],
): number {
  const top3 = actualResults.slice(0, 3);
  let total = 0;
  for (const p of predictions) {
    if (p.position < 1 || p.position > 3) continue;
    if (!top3.includes(p.country_code)) continue;
    if (top3[p.position - 1] === p.country_code) {
      total += 5;
    } else {
      total += 2;
    }
  }
  return total;
}

/**
 * Side-bet score for one guest.
 * For each bet that has a resolved_value, +1 if the guest's pick matches.
 * Unresolved bets contribute nothing. Missing picks contribute nothing.
 */
export function sideBetScore(picks: SideBetPick[], bets: SideBet[]): number {
  const pickByBetId = new Map(picks.map((p) => [p.bet_id, p.pick]));
  let total = 0;
  for (const bet of bets) {
    if (bet.resolved_value == null) continue;
    if (pickByBetId.get(bet.id) === bet.resolved_value) total += 1;
  }
  return total;
}
