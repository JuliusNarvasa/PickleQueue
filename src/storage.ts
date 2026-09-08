import type { MatchingMode, Player, Session } from './types';

const KEY = 'picklequeue_session';

// Old 9-mode ids → the FINAL 3. Anything unknown falls back to openplay.
const MODE_MAP: Record<string, MatchingMode> = {
  openplay: 'openplay',
  balanced: 'openplay',
  social: 'openplay',
  'winners-losers': 'openplay',
  'club-wars': 'openplay',
  tournament: 'openplay',
  normal: 'normal',
  'mixed-doubles': 'normal',
  'king-queen': 'normal',
  skillpairs: 'skillpairs',
  'skill-separated': 'skillpairs',
  'skill-courts': 'skillpairs',
};

function migratePlayer(raw: Record<string, unknown>): Player {
  const now = Date.now();
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? '?'),
    skill: typeof raw.skill === 'number' ? raw.skill : null,
    checkedIn: Boolean(raw.checkedIn),
    gamesPlayed: typeof raw.gamesPlayed === 'number' ? raw.gamesPlayed : 0,
    wins: typeof raw.wins === 'number' ? raw.wins : 0,
    losses: typeof raw.losses === 'number' ? raw.losses : 0,
    waitStartedAt: typeof raw.waitStartedAt === 'number' ? raw.waitStartedAt : now,
    checkedInAt: typeof raw.checkedInAt === 'number' ? raw.checkedInAt : null,
    lockedPartnerId: typeof raw.lockedPartnerId === 'string' ? raw.lockedPartnerId : null,
    recentPartners: Array.isArray(raw.recentPartners) ? raw.recentPartners as string[] : [],
    recentOpponents: Array.isArray(raw.recentOpponents) ? raw.recentOpponents as string[] : [],
    firstPlayedAt: typeof raw.firstPlayedAt === 'number' ? raw.firstPlayedAt : null,
    lastPlayedAt: typeof raw.lastPlayedAt === 'number' ? raw.lastPlayedAt : null,
  };
}

/** Migrate a persisted session (old 9-mode shape, gameLimit) to the FINAL design shape. */
export function migrate(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.players) || !Array.isArray(s.courtStates)) return null;
  return {
    id: typeof s.id === 'string' ? s.id : 'migrated',
    name: typeof s.name === 'string' ? s.name : 'Open Play',
    courts: typeof s.courts === 'number' ? s.courts : 2,
    format: s.format === 'singles' ? 'singles' : 'doubles',
    showLiveStandings: s.showLiveStandings !== false,
    matchingMode: MODE_MAP[String(s.matchingMode)] ?? 'openplay',
    players: (s.players as Record<string, unknown>[]).map(migratePlayer),
    courtStates: Array.isArray(s.courtStates) ? s.courtStates as Session['courtStates'] : [],
    upNext: Array.isArray(s.upNext) ? s.upNext as Session['upNext'] : [],
    matchLog: Array.isArray(s.matchLog) ? s.matchLog as Session['matchLog'] : [],
    startedAt: typeof s.startedAt === 'number' ? s.startedAt : null,
    endedAt: typeof s.endedAt === 'number' ? s.endedAt : null,
    matchDurationsSec: Array.isArray(s.matchDurationsSec) ? s.matchDurationsSec as number[] : [],
  };
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
