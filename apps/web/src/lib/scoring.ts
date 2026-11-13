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

export interface BallotEntry {
  /** Country the guest awarded points to. */
  country_code: string;
  /** Eurovision points (1,2,3,4,5,6,7,8,10,12). */
  points: number;
}

export interface AlignmentLine {
  country_code: string;
  guest_points: number;
  /** Country's actual official position (1..N) or null if outside the official ranking. */
  official_position: number | null;
  /** What an Eurovision-clairvoyant juror would have awarded this country (0 if not in actual top-10). */
  ideal_points: number;
  /** Contribution to alignment for this line: min(guest_points, ideal_points). */
  contribution: number;
}

export interface AlignmentBreakdown {
  /** Sum of contributions across all of the guest's votes. Max is 58 (a perfect ballot). */
  score: number;
  /** Per-vote rows, sorted by the guest's awarded points descending. */
  lines: AlignmentLine[];
  /** Number of the guest's 10 picks that landed in the actual top 10. */
  topTenHits: number;
}

/**
 * Score one guest's ballot for "alignment" with the official Eurovision result.
 *
 * The metric is Eurovision-native: each official rank maps to an "ideal"
 * point award (1st→12, 2nd→10, 3rd→8, 4th→7, … 10th→1, 11+→0). For each
 * country the guest awarded points to, the line contributes
 * `min(guest_points, ideal_points)`. A perfectly-aligned ballot maxes at 58.
 *
 * Pure function — caller provides the rank→ideal-points lookup so this stays
 * year-agnostic and easy to unit test. Pass `(code) => idealPointsFor(code)`
 * from `eurovision-2026.ts` for the 2026 final.
 */
export function alignmentBreakdown(
  ballot: BallotEntry[],
  idealPoints: (code: string) => number,
  officialPosition: (code: string) => number | null,
): AlignmentBreakdown {
  let score = 0;
  let topTenHits = 0;
  const lines: AlignmentLine[] = ballot.map((entry) => {
    const ideal = idealPoints(entry.country_code);
    const pos = officialPosition(entry.country_code);
    const contribution = Math.min(entry.points, ideal);
    score += contribution;
    if (pos != null && pos <= 10) topTenHits += 1;
    return {
      country_code: entry.country_code,
      guest_points: entry.points,
      official_position: pos,
      ideal_points: ideal,
      contribution,
    };
  });
  lines.sort((a, b) => b.guest_points - a.guest_points);
  return { score, lines, topTenHits };
}
