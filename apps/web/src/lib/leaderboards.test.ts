import { describe, it, expect } from 'vitest';
import {
  predictionLeaderboard,
  sideBetLeaderboard,
  type GuestLike,
  type PredictionRow,
  type SideBetPickRow,
  type ActualResultRow,
} from './leaderboards';
import type { SideBet } from './scoring';

const guests: GuestLike[] = [
  { id: 'g1', display_name: 'Alice' },
  { id: 'g2', display_name: 'Bob' },
  { id: 'g3', display_name: 'Charlie' },
];

const actual: ActualResultRow[] = [
  { position: 1, country_code: 'SE' },
  { position: 2, country_code: 'IT' },
  { position: 3, country_code: 'FR' },
];

describe('predictionLeaderboard', () => {
  it('scores guests against actual top-3 and sorts descending', () => {
    const preds: PredictionRow[] = [
      // Alice: SE@1 exact (5), IT@2 exact (5), FR@3 exact (5) = 15
      { guest_id: 'g1', position: 1, country_code: 'SE' },
      { guest_id: 'g1', position: 2, country_code: 'IT' },
      { guest_id: 'g1', position: 3, country_code: 'FR' },
      // Bob: IT@1 in-top-3 (2), SE@2 in-top-3 (2), NO@3 not (0) = 4
      { guest_id: 'g2', position: 1, country_code: 'IT' },
      { guest_id: 'g2', position: 2, country_code: 'SE' },
      { guest_id: 'g2', position: 3, country_code: 'NO' },
      // Charlie: no predictions = 0
    ];
    const board = predictionLeaderboard(guests, preds, actual);
    expect(board).toEqual([
      { guestId: 'g1', displayName: 'Alice', score: 15 },
      { guestId: 'g2', displayName: 'Bob', score: 4 },
      { guestId: 'g3', displayName: 'Charlie', score: 0 },
    ]);
  });

  it('alphabetises ties on display_name', () => {
    const preds: PredictionRow[] = [
      { guest_id: 'g2', position: 1, country_code: 'SE' }, // Bob: 5
      { guest_id: 'g3', position: 1, country_code: 'SE' }, // Charlie: 5
      { guest_id: 'g1', position: 1, country_code: 'SE' }, // Alice: 5
    ];
    const board = predictionLeaderboard(guests, preds, actual);
    expect(board.map((r) => r.displayName)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('returns 0s for everyone when actualResults is empty/null', () => {
    const preds: PredictionRow[] = [
      { guest_id: 'g1', position: 1, country_code: 'SE' },
    ];
    const board = predictionLeaderboard(guests, preds, null);
    expect(board.every((r) => r.score === 0)).toBe(true);
    expect(board.length).toBe(3);
  });

  it('sorts actualResults by position internally before scoring', () => {
    const scrambled: ActualResultRow[] = [
      { position: 3, country_code: 'FR' },
      { position: 1, country_code: 'SE' },
      { position: 2, country_code: 'IT' },
    ];
    const preds: PredictionRow[] = [
      { guest_id: 'g1', position: 1, country_code: 'SE' },
    ];
    const board = predictionLeaderboard(guests, preds, scrambled);
    expect(board[0]).toEqual({ guestId: 'g1', displayName: 'Alice', score: 5 });
  });
});

describe('sideBetLeaderboard', () => {
  const bets: SideBet[] = [
    { id: 'b1', resolved_value: 'yes' },
    { id: 'b2', resolved_value: 'SE' },
    { id: 'b3', resolved_value: null }, // unresolved → ignored
  ];

  it('counts correct picks per guest, ignores unresolved bets', () => {
    const picks: SideBetPickRow[] = [
      // Alice: b1 hit, b2 hit, b3 (ignored) = 2
      { guest_id: 'g1', bet_id: 'b1', pick: 'yes' },
      { guest_id: 'g1', bet_id: 'b2', pick: 'SE' },
      { guest_id: 'g1', bet_id: 'b3', pick: 'yes' },
      // Bob: b1 miss, b2 hit = 1
      { guest_id: 'g2', bet_id: 'b1', pick: 'no' },
      { guest_id: 'g2', bet_id: 'b2', pick: 'SE' },
      // Charlie: no picks = 0
    ];
    const board = sideBetLeaderboard(guests, bets, picks);
    expect(board).toEqual([
      { guestId: 'g1', displayName: 'Alice', score: 2 },
      { guestId: 'g2', displayName: 'Bob', score: 1 },
      { guestId: 'g3', displayName: 'Charlie', score: 0 },
    ]);
  });

  it('alphabetises ties', () => {
    const picks: SideBetPickRow[] = [
      { guest_id: 'g2', bet_id: 'b1', pick: 'yes' },
      { guest_id: 'g1', bet_id: 'b1', pick: 'yes' },
      { guest_id: 'g3', bet_id: 'b1', pick: 'yes' },
    ];
    const board = sideBetLeaderboard(guests, bets, picks);
    expect(board.map((r) => r.displayName)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('returns zeroes when there are no resolved bets at all', () => {
    const unresolved: SideBet[] = [{ id: 'b1', resolved_value: null }];
    const picks: SideBetPickRow[] = [
      { guest_id: 'g1', bet_id: 'b1', pick: 'yes' },
    ];
    const board = sideBetLeaderboard(guests, unresolved, picks);
    expect(board.every((r) => r.score === 0)).toBe(true);
  });
});
