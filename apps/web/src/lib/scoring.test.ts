import { describe, it, expect } from 'vitest';
import {
  tallyRoomResults,
  predictionScore,
  sideBetScore,
  alignmentBreakdown,
  type Vote,
  type ReactionLike,
  type Prediction,
  type SideBet,
  type SideBetPick,
  type BallotEntry,
} from './scoring';

describe('tallyRoomResults', () => {
  it('sums points per country and sorts descending', () => {
    const votes: Vote[] = [
      { guest_id: 'g1', country_code: 'SE', points: 12 },
      { guest_id: 'g1', country_code: 'IT', points: 10 },
      { guest_id: 'g2', country_code: 'IT', points: 12 },
      { guest_id: 'g2', country_code: 'SE', points: 8 },
      { guest_id: 'g2', country_code: 'FR', points: 7 },
    ];
    const result = tallyRoomResults(votes);
    expect(result).toEqual([
      { country: 'IT', points: 22 },
      { country: 'SE', points: 20 },
      { country: 'FR', points: 7 },
    ]);
  });

  it('breaks ties using total reactions (more reactions wins)', () => {
    const votes: Vote[] = [
      { guest_id: 'g1', country_code: 'SE', points: 10 },
      { guest_id: 'g1', country_code: 'IT', points: 10 },
    ];
    const reactions: ReactionLike[] = [
      { country_code: 'SE', rating: 5 },
      { country_code: 'SE', rating: 4 },
      { country_code: 'IT', rating: 3 },
    ];
    const result = tallyRoomResults(votes, reactions);
    expect(result[0]?.country).toBe('SE');
    expect(result[1]?.country).toBe('IT');
  });

  it('breaks ties using country code ascending when points + reactions equal', () => {
    const votes: Vote[] = [
      { guest_id: 'g1', country_code: 'NO', points: 5 },
      { guest_id: 'g1', country_code: 'DE', points: 5 },
      { guest_id: 'g1', country_code: 'AT', points: 5 },
    ];
    const result = tallyRoomResults(votes);
    expect(result.map((r) => r.country)).toEqual(['AT', 'DE', 'NO']);
  });

  it('returns empty array for no votes', () => {
    expect(tallyRoomResults([])).toEqual([]);
  });
});

describe('predictionScore', () => {
  const actual = ['SE', 'IT', 'FR', 'NO', 'DE'];

  it('awards 5 pts for each exact position match', () => {
    const preds: Prediction[] = [
      { position: 1, country_code: 'SE' },
      { position: 2, country_code: 'IT' },
      { position: 3, country_code: 'FR' },
    ];
    expect(predictionScore(preds, actual)).toBe(15);
  });

  it('awards 2 pts for in-top-3 but wrong position', () => {
    const preds: Prediction[] = [
      { position: 1, country_code: 'IT' }, // IT is #2, so 2 pts
      { position: 2, country_code: 'SE' }, // SE is #1, so 2 pts
      { position: 3, country_code: 'FR' }, // FR is #3, exact, 5 pts
    ];
    expect(predictionScore(preds, actual)).toBe(9);
  });

  it('awards 0 pts when none of the predictions are in top-3', () => {
    const preds: Prediction[] = [
      { position: 1, country_code: 'NO' },
      { position: 2, country_code: 'DE' },
      { position: 3, country_code: 'XX' },
    ];
    expect(predictionScore(preds, actual)).toBe(0);
  });

  it('ignores out-of-range positions', () => {
    const preds: Prediction[] = [
      { position: 0, country_code: 'SE' },
      { position: 4, country_code: 'IT' },
      { position: 1, country_code: 'SE' },
    ];
    expect(predictionScore(preds, actual)).toBe(5);
  });

  it('mixed exact + partial credit', () => {
    const preds: Prediction[] = [
      { position: 1, country_code: 'SE' }, // exact, 5
      { position: 2, country_code: 'FR' }, // in top-3 wrong pos, 2
      { position: 3, country_code: 'NO' }, // not in top-3, 0
    ];
    expect(predictionScore(preds, actual)).toBe(7);
  });
});

describe('sideBetScore', () => {
  it('counts matching picks against resolved bets', () => {
    const bets: SideBet[] = [
      { id: 'b1', resolved_value: 'yes' },
      { id: 'b2', resolved_value: 'SE' },
      { id: 'b3', resolved_value: 'no' },
    ];
    const picks: SideBetPick[] = [
      { bet_id: 'b1', pick: 'yes' }, // hit
      { bet_id: 'b2', pick: 'IT' }, // miss
      { bet_id: 'b3', pick: 'no' }, // hit
    ];
    expect(sideBetScore(picks, bets)).toBe(2);
  });

  it('unresolved bets contribute zero even if pick matches a guess', () => {
    const bets: SideBet[] = [
      { id: 'b1', resolved_value: null },
      { id: 'b2', resolved_value: null },
    ];
    const picks: SideBetPick[] = [
      { bet_id: 'b1', pick: 'yes' },
      { bet_id: 'b2', pick: 'no' },
    ];
    expect(sideBetScore(picks, bets)).toBe(0);
  });

  it('missing picks contribute zero', () => {
    const bets: SideBet[] = [
      { id: 'b1', resolved_value: 'yes' },
      { id: 'b2', resolved_value: 'no' },
    ];
    expect(sideBetScore([], bets)).toBe(0);
  });

  it('extra picks for nonexistent bets are ignored', () => {
    const bets: SideBet[] = [{ id: 'b1', resolved_value: 'yes' }];
    const picks: SideBetPick[] = [
      { bet_id: 'b1', pick: 'yes' },
      { bet_id: 'b-ghost', pick: 'yes' },
    ];
    expect(sideBetScore(picks, bets)).toBe(1);
  });
});

describe('alignmentBreakdown', () => {
  // Fake official ranking for the tests: 1=AA, 2=BB, 3=CC, 4=DD, … 10=JJ.
  const SCHEME: Record<number, number> = {
    1: 12, 2: 10, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1,
  };
  const POSITIONS: Record<string, number> = {
    AA: 1, BB: 2, CC: 3, DD: 4, EE: 5, FF: 6, GG: 7, HH: 8, II: 9, JJ: 10,
    KK: 11, LL: 12, MM: 13,
  };
  const idealPoints = (code: string) => {
    const pos = POSITIONS[code];
    return pos != null ? SCHEME[pos] ?? 0 : 0;
  };
  const officialPosition = (code: string) => POSITIONS[code] ?? null;

  it('returns 58 for a perfectly-aligned ballot', () => {
    const ballot: BallotEntry[] = [
      { country_code: 'AA', points: 12 },
      { country_code: 'BB', points: 10 },
      { country_code: 'CC', points: 8 },
      { country_code: 'DD', points: 7 },
      { country_code: 'EE', points: 6 },
      { country_code: 'FF', points: 5 },
      { country_code: 'GG', points: 4 },
      { country_code: 'HH', points: 3 },
      { country_code: 'II', points: 2 },
      { country_code: 'JJ', points: 1 },
    ];
    const result = alignmentBreakdown(ballot, idealPoints, officialPosition);
    expect(result.score).toBe(58);
    expect(result.topTenHits).toBe(10);
  });

  it('uses min(guest, ideal) for mismatched positions', () => {
    // Guest gave 12 to the actual #2 → min(12,10)=10. Guest gave 10 to actual #1 → min(10,12)=10.
    const ballot: BallotEntry[] = [
      { country_code: 'BB', points: 12 },
      { country_code: 'AA', points: 10 },
    ];
    const result = alignmentBreakdown(ballot, idealPoints, officialPosition);
    expect(result.score).toBe(20);
    expect(result.topTenHits).toBe(2);
  });

  it('countries outside the official top-10 contribute zero', () => {
    const ballot: BallotEntry[] = [
      { country_code: 'KK', points: 12 }, // #11 → ideal 0
      { country_code: 'LL', points: 10 }, // #12 → ideal 0
      { country_code: 'MM', points: 8 },  // #13 → ideal 0
    ];
    const result = alignmentBreakdown(ballot, idealPoints, officialPosition);
    expect(result.score).toBe(0);
    expect(result.topTenHits).toBe(0);
  });

  it('countries not in the official ranking at all also contribute zero', () => {
    const ballot: BallotEntry[] = [
      { country_code: 'ZZ', points: 12 },
    ];
    const result = alignmentBreakdown(ballot, idealPoints, officialPosition);
    expect(result.score).toBe(0);
    expect(result.lines[0]?.official_position).toBeNull();
  });

  it('sorts lines by guest_points descending', () => {
    const ballot: BallotEntry[] = [
      { country_code: 'BB', points: 1 },
      { country_code: 'AA', points: 12 },
      { country_code: 'CC', points: 5 },
    ];
    const result = alignmentBreakdown(ballot, idealPoints, officialPosition);
    expect(result.lines.map((l) => l.guest_points)).toEqual([12, 5, 1]);
  });

  it('returns zero score and empty lines for an empty ballot', () => {
    const result = alignmentBreakdown([], idealPoints, officialPosition);
    expect(result.score).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.topTenHits).toBe(0);
  });
});
