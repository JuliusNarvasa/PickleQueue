import { describe, expect, it } from 'vitest';
import type { MatchingMode } from './types';
import type { Player } from './types';
import { applyResult, buildUpNext, spread } from './scheduler';

function makeRoster(n: number): Player[] {
  const now = 1000;
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    skill: ((i % 6) + 1) as number,
    gender: i % 2 === 0 ? 'M' : 'F',
    checkedIn: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    waitStartedAt: now + i, // staggered arrival = deterministic queue order
    checkedInAt: now,
    presentMinutes: 0,
    lockedPartnerId: null,
    recentPartners: [],
    recentOpponents: [],
  }));
}

const MODES: MatchingMode[] = [
  'balanced', 'social', 'skill-separated', 'winners-losers',
  'skill-courts', 'mixed-doubles', 'king-queen', 'club-wars', 'tournament',
];

/**
 * Fairness acceptance: 12 players, 2 courts (8 seats in play), 20 games.
 * After every game the scheduler drafts from fewest-games-first, so the
 * games-played spread across the checked-in roster must stay <= 1 whenever
 * the roster allows (12-player roster with 4-per-game always allows it).
 */
describe.each(MODES)('fairness: %s', (mode) => {
  it('keeps games-played spread <= 1 over 20 games (12 players, 2 courts)', () => {
    let players = makeRoster(12);
    for (let g = 0; g < 20; g++) {
      const staged = buildUpNext(players, new Set(), mode, 'doubles', 2);
      expect(staged.length).toBeGreaterThan(0);
      // Play the first staged match; alternate winners for realism.
      const m = staged[0];
      players = applyResult(players, m.teamA, m.teamB, g % 2 === 0 ? 'A' : 'B');
      expect(spread(players)).toBeLessThanOrEqual(1);
    }
  });
});

describe('fairness: singles', () => {
  it('keeps spread <= 1 over 20 games (12 players, 2 courts)', () => {
    let players = makeRoster(12);
    for (let g = 0; g < 20; g++) {
      const staged = buildUpNext(players, new Set(), 'balanced', 'singles', 2);
      expect(staged.length).toBeGreaterThan(0);
      const m = staged[0];
      players = applyResult(players, m.teamA, m.teamB, g % 2 === 0 ? 'A' : 'B');
      expect(spread(players)).toBeLessThanOrEqual(1);
    }
  });
});
