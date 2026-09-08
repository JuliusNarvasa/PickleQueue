import type { Format, MatchingMode, Player } from './types';

/**
 * FAIRNESS RULE: in EVERY matching mode, the candidate pool is sorted by
 * fewest gamesPlayed first (then longest waiting). All modes pick from the
 * head of that fair ordering, so a late check-in (0 games) automatically
 * lands on top of the queue and the games-played spread stays minimal
 * (<=1 whenever roster size allows). Modes differ ONLY in how the picked
 * players are arranged into teams — never in who gets picked.
 */
export function fairPool(players: Player[], exclude: Set<string> = new Set()): Player[] {
  return players
    .filter((p) => p.checkedIn && !exclude.has(p.id))
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.waitStartedAt - b.waitStartedAt);
}

export function spread(players: Player[]): number {
  const elig = players.filter((p) => p.checkedIn);
  if (elig.length === 0) return 0;
  const gs = elig.map((p) => p.gamesPlayed);
  return Math.max(...gs) - Math.min(...gs);
}

const skillOf = (p: Player) => p.skill ?? 3;

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function honorLock(a: Player[], b: Player[], four: Player[]): { a: Player[]; b: Player[] } {
  // If a locked pair ended up split across teams, swap to reunite them.
  for (const p of four) {
    if (!p.lockedPartnerId) continue;
    const mate = four.find((q) => q.id === p.lockedPartnerId);
    if (!mate) continue;
    const pTeam = a.includes(p) ? a : b.includes(p) ? b : null;
    const mTeam = a.includes(mate) ? a : b.includes(mate) ? b : null;
    if (pTeam && mTeam && pTeam !== mTeam) {
      const pi = pTeam.indexOf(p);
      const mi = mTeam.indexOf(mate);
      const other = mTeam[mi === 0 ? 1 : 0];
      pTeam[pi] = other;
      mTeam[mi === 0 ? 1 : 0] = p;
      return { a, b };
    }
  }
  return { a, b };
}

export interface BuiltMatch { teamA: string[]; teamB: string[] }

/** Build ONE match from the head of the fair pool. Returns null if not enough players. */
export function buildMatch(
  players: Player[],
  exclude: Set<string>,
  mode: MatchingMode,
  format: Format,
): BuiltMatch | null {
  const pool = fairPool(players, exclude);
  const need = format === 'singles' ? 2 : 4;
  if (pool.length < need) return null;

  if (format === 'singles') {
    const two = pool.slice(0, 2);
    return { teamA: [two[0].id], teamB: [two[1].id] };
  }

  const ids = (ps: Player[]) => ps.map((p) => p.id);
  const finish = (a: Player[], b: Player[]): BuiltMatch => {
    const fixed = honorLock(a, b, [...a, ...b]);
    return { teamA: ids(fixed.a), teamB: ids(fixed.b) };
  };
  const head = pool.slice(0, 4);

  switch (mode) {
    case 'openplay': {
      // Random pairing every match, drawn from the fair head.
      const s = shuffled(head);
      return finish([s[0], s[1]], [s[2], s[3]]);
    }
    case 'normal': {
      // Locked-in pairs stay together; everyone else filled in at random.
      const s = shuffled(head);
      const mateOf = (p: Player) => s.find((q) => q.id === p.lockedPartnerId);
      for (const p of s) {
        const mate = mateOf(p);
        if (mate) return finish([p, mate], s.filter((q) => q !== p && q !== mate));
      }
      return finish([s[0], s[1]], [s[2], s[3]]);
    }
    case 'skillpairs': {
      // Similar skills share the court: lower-half vs upper-half teams,
      // so winners naturally rotate up against stronger players.
      const bySkill = [...head].sort((x, y) => skillOf(x) - skillOf(y));
      return finish([bySkill[0], bySkill[1]], [bySkill[2], bySkill[3]]);
    }
  }
}

/** Stage up to `count` auto matches, each from the fair head excluding already-seated players. */
export function buildUpNext(
  players: Player[],
  exclude: Set<string>,
  mode: MatchingMode,
  format: Format,
  count: number,
): BuiltMatch[] {
  const out: BuiltMatch[] = [];
  const used = new Set(exclude);
  for (let i = 0; i < count; i++) {
    const m = buildMatch(players, used, mode, format);
    if (!m) break;
    out.push(m);
    [...m.teamA, ...m.teamB].forEach((id) => used.add(id));
  }
  return out;
}

/** Apply a recorded result (mutates a copy): gamesPlayed+1 for all, W/L, partner/opponent memory. */
export function applyResult(
  players: Player[],
  teamA: string[],
  teamB: string[],
  winner: 'A' | 'B',
): Player[] {
  const now = Date.now();
  const winners = winner === 'A' ? teamA : teamB;
  const losers = winner === 'A' ? teamB : teamA;
  const wset = new Set(winners);
  return players.map((p) => {
    if (!teamA.includes(p.id) && !teamB.includes(p.id)) return p;
    const won = wset.has(p.id);
    const mates = (winners.includes(p.id) ? winners : losers).filter((id) => id !== p.id);
    const opps = (winners.includes(p.id) ? losers : winners);
    return {
      ...p,
      gamesPlayed: p.gamesPlayed + 1,
      wins: p.wins + (won ? 1 : 0),
      losses: p.losses + (won ? 0 : 1),
      waitStartedAt: now,
      firstPlayedAt: p.firstPlayedAt ?? now,
      lastPlayedAt: now,
      recentPartners: [...mates, ...p.recentPartners].slice(0, 6),
      recentOpponents: [...opps, ...p.recentOpponents].slice(0, 12),
    };
  });
}

/** FINAL STANDINGS sort: wins desc → exact win rate desc → schedule strength desc (sum of opponents' wins). */
export function rankStandings(players: Player[]): Player[] {
  const winsById = new Map(players.map((p) => [p.id, p.wins]));
  const strength = (p: Player) =>
    p.recentOpponents.reduce((s, id) => s + (winsById.get(id) ?? 0), 0);
  const rate = (p: Player) => (p.gamesPlayed === 0 ? -1 : p.wins / p.gamesPlayed);
  return [...players]
    .filter((p) => p.gamesPlayed > 0)
    .sort((a, b) => b.wins - a.wins || rate(b) - rate(a) || strength(b) - strength(a));
}
