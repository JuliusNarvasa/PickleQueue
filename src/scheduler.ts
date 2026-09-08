import type { Format, MatchingMode, Player } from './types';

/**
 * FAIRNESS RULE (acceptance #1): in EVERY matching mode, the candidate pool
 * is sorted by fewest gamesPlayed first (then longest waiting). All modes
 * pick from the head of that fair ordering, so the games-played spread
 * stays minimal (<=1 whenever roster size allows).
 */
export function fairPool(players: Player[], exclude: Set<string> = new Set(), cap: number | null = null): Player[] {
  return players
    .filter((p) => p.checkedIn && !exclude.has(p.id) && (cap == null || p.gamesPlayed < cap))
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.waitStartedAt - b.waitStartedAt);
}

export function spread(players: Player[]): number {
  const elig = players.filter((p) => p.checkedIn);
  if (elig.length === 0) return 0;
  const gs = elig.map((p) => p.gamesPlayed);
  return Math.max(...gs) - Math.min(...gs);
}

const skillOf = (p: Player) => p.skill ?? 3;

function pairBalanced(four: Player[]): { a: Player[]; b: Player[] } {
  // Try all 3 pairings; pick most skill-balanced, penalize recent-partner repeats.
  const [p1, p2, p3, p4] = four;
  const opts: [Player[], Player[]][] = [
    [[p1, p2], [p3, p4]],
    [[p1, p3], [p2, p4]],
    [[p1, p4], [p2, p3]],
  ];
  let best = opts[0];
  let bestScore = Infinity;
  for (const [t1, t2] of opts) {
    const diff = Math.abs(skillOf(t1[0]) + skillOf(t1[1]) - skillOf(t2[0]) - skillOf(t2[1]));
    const repeat =
      (t1[0].recentPartners.includes(t1[1].id) ? 2 : 0) +
      (t2[0].recentPartners.includes(t2[1].id) ? 2 : 0);
    const score = diff + repeat;
    if (score < bestScore) { bestScore = score; best = [t1, t2]; }
  }
  return { a: best[0], b: best[1] };
}

function pairSocial(four: Player[]): { a: Player[]; b: Player[] } {
  // Prefer never-before partners; skill ignored.
  const [p1, p2, p3, p4] = four;
  const opts: [Player[], Player[]][] = [
    [[p1, p2], [p3, p4]],
    [[p1, p3], [p2, p4]],
    [[p1, p4], [p2, p3]],
  ];
  const pen = (x: Player, y: Player) =>
    (x.recentPartners.includes(y.id) ? 10 : 0) + (x.recentOpponents.includes(y.id) ? 1 : 0);
  let best = opts[0];
  let bestScore = Infinity;
  for (const [t1, t2] of opts) {
    const s = pen(t1[0], t1[1]) + pen(t2[0], t2[1]);
    if (s < bestScore) { bestScore = s; best = [t1, t2]; }
  }
  return { a: best[0], b: best[1] };
}

function resolveLocks(four: Player[]): Player[] {
  // If two players locked each other, keep them adjacent in pick order so
  // pairing functions can keep them together when fair.
  const out = [...four];
  for (let i = 0; i < out.length; i++) {
    const lock = out[i].lockedPartnerId;
    if (!lock) continue;
    const j = out.findIndex((p) => p.id === lock);
    if (j > i + 1) {
      const [mv] = out.splice(j, 1);
      out.splice(i + 1, 0, mv);
    }
  }
  return out;
}

function honorLock(a: Player[], b: Player[], four: Player[]): { a: Player[]; b: Player[] } {
  // If a locked pair ended up split across teams, swap to reunite them.
  // Both teams are size 2: p leaves pTeam, the teammate opposite the mate
  // takes p's place, and p joins the mate's team. Same 4 players, order kept.
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
  cap: number | null = null,
): BuiltMatch | null {
  const pool = fairPool(players, exclude, cap);
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
  // FAIRNESS: every mode selects exactly the fair head (fewest games first).
  // Modes differ ONLY in how those players are arranged into teams —
  // never in who gets picked. This is what keeps the spread <= 1.
  const fairFour = (): Player[] => resolveLocks(pool.slice(0, 4));

  switch (mode) {
    case 'social': {
      const { a, b } = pairSocial(fairFour());
      return finish(a, b);
    }
    case 'skill-separated':
    case 'skill-courts': {
      // Similar skills share the court (they do — one court); split the
      // fair four into lower-half vs upper-half teams.
      const bySkill = [...fairFour()].sort((x, y) => skillOf(x) - skillOf(y));
      return finish([bySkill[0], bySkill[1]], [bySkill[2], bySkill[3]]);
    }
    case 'winners-losers': {
      // Winners team vs losers team, drawn from the fair head.
      const winRate = (p: Player) =>
        p.gamesPlayed === 0 ? -1 : p.wins / p.gamesPlayed;
      const ranked = [...fairFour()].sort((x, y) => winRate(y) - winRate(x));
      return finish([ranked[0], ranked[1]], [ranked[2], ranked[3]]);
    }
    case 'mixed-doubles': {
      const four = fairFour();
      const men = four.filter((p) => p.gender === 'M');
      const women = four.filter((p) => p.gender === 'F');
      if (men.length === 2 && women.length === 2) {
        return finish([women[0], men[0]], [women[1], men[1]]);
      }
      const { a, b } = pairBalanced(four);
      return finish(a, b);
    }
    case 'king-queen': {
      // Winners (kings) get priority pairing against lowest-games challengers —
      // still drawn from fair head so spread stays minimal.
      const four = fairFour();
      const ranked = [...four].sort((x, y) => y.wins - x.wins || x.gamesPlayed - y.gamesPlayed);
      return finish([ranked[0], ranked[3]], [ranked[1], ranked[2]]);
    }
    case 'club-wars': {
      // Alternate fair order into two squads (snake draft).
      const four = fairFour();
      return finish([four[0], four[3]], [four[1], four[2]]);
    }
    case 'tournament':
    case 'balanced':
    default: {
      const four = resolveLocks(pool.slice(0, 4));
      // Locked pairs stay together:
      const locked: Player[] = [];
      const rest: Player[] = [];
      for (const p of four) {
        const mateLocked = p.lockedPartnerId && four.some((q) => q.id === p.lockedPartnerId);
        (mateLocked ? locked : rest).push(p);
      }
      if (locked.length === 2 && locked[0].lockedPartnerId === locked[1].id) {
        const others = four.filter((p) => !locked.includes(p));
        return finish([locked[0], locked[1]], others as Player[]);
      }
      const { a, b } = pairBalanced(four);
      return finish(a, b);
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
  cap: number | null = null,
): BuiltMatch[] {
  const out: BuiltMatch[] = [];
  const used = new Set(exclude);
  for (let i = 0; i < count; i++) {
    const m = buildMatch(players, used, mode, format, cap);
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
      waitStartedAt: Date.now(),
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
