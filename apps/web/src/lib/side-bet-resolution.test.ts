// Tests for sideBetScore (in scoring.ts) focused on host-resolution semantics.
// Scoring.test.ts already exercises the basic counting behaviour; this file
// drills into the four cases the brief calls out:
//   - resolved bet + correct pick  → +1
//   - resolved bet + wrong pick    →  0
//   - unresolved bet (any pick)    →  0
//   - resolved bet + missing pick  →  0
//
// Why a separate file? Keeps the per-feature test surface easy to find —
// host code lives next to host tests.
import { describe, it, expect } from 'vitest';
import {
  sideBetScore,
  type SideBet,
  type SideBetPick,
} from './scoring';

describe('side-bet resolution scoring', () => {
  it('awards 1pt when a resolved bet matches the guest pick', () => {
    const bets: SideBet[] = [{ id: 'b1', resolved_value: 'yes' }];
    const picks: SideBetPick[] = [{ bet_id: 'b1', pick: 'yes' }];
    expect(sideBetScore(picks, bets)).toBe(1);
  });

  it('awards 0pt when a resolved bet does not match the guest pick', () => {
    const bets: SideBet[] = [{ id: 'b1', resolved_value: 'yes' }];
    const picks: SideBetPick[] = [{ bet_id: 'b1', pick: 'no' }];
    expect(sideBetScore(picks, bets)).toBe(0);
  });

  it('awards 0pt for unresolved bets even when picks exist', () => {
    const bets: SideBet[] = [{ id: 'b1', resolved_value: null }];
    const picks: SideBetPick[] = [{ bet_id: 'b1', pick: 'yes' }];
    expect(sideBetScore(picks, bets)).toBe(0);
  });

  it('awards 0pt for a resolved bet with no matching pick row', () => {
    const bets: SideBet[] = [{ id: 'b1', resolved_value: 'yes' }];
    expect(sideBetScore([], bets)).toBe(0);
  });

  it('accumulates across multiple bets correctly', () => {
    const bets: SideBet[] = [
      { id: 'b1', resolved_value: 'SE' },       // hit
      { id: 'b2', resolved_value: 'IT' },       // miss
      { id: 'b3', resolved_value: null },       // unresolved
      { id: 'b4', resolved_value: 'yes' },      // missing pick
      { id: 'b5', resolved_value: 'no' },       // hit
    ];
    const picks: SideBetPick[] = [
      { bet_id: 'b1', pick: 'SE' },
      { bet_id: 'b2', pick: 'FR' },
      { bet_id: 'b3', pick: 'yes' },
      // no pick for b4
      { bet_id: 'b5', pick: 'no' },
    ];
    expect(sideBetScore(picks, bets)).toBe(2);
  });

  it('a country bet resolved to the same code as another guest picked sums independently', () => {
    // Two guests with different picks against the same bet — sideBetScore
    // is per-guest, so each guest's picks list yields its own total.
    const bets: SideBet[] = [{ id: 'b1', resolved_value: 'SE' }];
    expect(sideBetScore([{ bet_id: 'b1', pick: 'SE' }], bets)).toBe(1);
    expect(sideBetScore([{ bet_id: 'b1', pick: 'NO' }], bets)).toBe(0);
  });
});
