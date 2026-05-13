import { describe, it, expect } from 'vitest';
import {
  tallyRoomResults,
  predictionScore,
  sideBetScore,
  type Vote,
  type ReactionLike,
  type Prediction,
  type SideBet,
  type SideBetPick,
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
