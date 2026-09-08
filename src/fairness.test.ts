import { describe, expect, it } from 'vitest';
import type { MatchingMode, Player } from './types';
import { applyResult, buildUpNext, fairPool, spread } from './scheduler';

function makePlayer(id: string, games: number, wait: number): Player {
  return {
    id, name: id, skill: 3, checkedIn: true,
    gamesPlayed: games, wins: 0, losses: 0,
    waitStartedAt: wait, checkedInAt: wait,
    lockedPartnerId: null, recentPartners: [], recentOpponents: [],
    firstPlayedAt: games > 0 ? wait : null, lastPlayedAt: games > 0 ? wait : null,
  };
}

function makeRoster(n: number, gamesOf: (i: number) => number = () => 0): Player[] {
  return Array.from({ length: n }, (_, i) => makePlayer(`p${i}`, gamesOf(i), 1000 + i));
}

const MODES: MatchingMode[] = ['openplay', 'normal', 'skillpairs'];

/**
 * Fairness acceptance: 12 players, 2 courts, 20 games.
 * The scheduler always drafts from fewest-games-first, so the
 * games-played spread across the checked-in roster must stay <= 1.
 */
describe.each(MODES)('fairness: %s', (mode) => {
  it('keeps games-played spread <= 1 over 20 games (12 players, 2 courts)', () => {
    let players = makeRoster(12);
    for (let g = 0; g < 20; g++) {
      const staged = buildUpNext(players, new Set(), mode, 'doubles', 2);
      expect(staged.length).toBeGreaterThan(0);
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
      const staged = buildUpNext(players, new Set(), 'openplay', 'singles', 2);
      expect(staged.length).toBeGreaterThan(0);
      const m = staged[0];
      players = applyResult(players, m.teamA, m.teamB, g % 2 === 0 ? 'A' : 'B');
      expect(spread(players)).toBeLessThanOrEqual(1);
    }
  });
});

describe('late check-in', () => {
  it('a 0-game late arrival lands on top of the queue in every mode', () => {
    for (const mode of MODES) {
      // 8 incumbents mid-session with 2-3 games each.
      const players = makeRoster(8, (i) => 2 + (i % 2));
      const late = makePlayer('riley', 0, 9999);
      const all = [...players, late];
      expect(fairPool(all, new Set())[0].id).toBe('riley');
    }
  });

  it('restaging after a late check-in puts the newcomer in the next match', () => {
    // 8 players, 2 courts: 8 seated, newcomer checks in late.
    const players = makeRoster(8, () => 2);
    const seated = new Set(players.map((p) => p.id));
    const late = makePlayer('riley', 0, 9999);
    const all = [...players, late];
    // Courts free up: exclude nobody seated anymore except 4 still playing.
    const stillSeated = new Set(['p0', 'p1', 'p2', 'p3']);
    const staged = buildUpNext(all, stillSeated, 'openplay', 'doubles', 1);
    expect(staged.length).toBe(1);
    expect([...staged[0].teamA, ...staged[0].teamB]).toContain('riley');
    void seated;
  });

  it('lowest game count wins over earlier arrival time', () => {
    const early = makePlayer('early', 3, 1000);
    const late = makePlayer('late', 1, 9999);
    expect(fairPool([early, late])[0].id).toBe('late');
  });
});
