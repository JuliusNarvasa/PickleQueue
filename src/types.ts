// Core domain types — local session only (no backend).
// Matching modes are FINAL (3): openplay · normal · skillpairs.
export type Format = 'doubles' | 'singles';
export type MatchingMode = 'openplay' | 'normal' | 'skillpairs';

export interface Player {
  id: string;
  name: string;
  skill: number | null; // 1-6 stars
  checkedIn: boolean;
  gamesPlayed: number;
  wins: number;
  losses: number;
  waitStartedAt: number; // epoch ms — queue order tiebreak
  checkedInAt: number | null;
  lockedPartnerId: string | null;
  recentPartners: string[];
  recentOpponents: string[];
  firstPlayedAt: number | null; // participation tracking
  lastPlayedAt: number | null;
}

export interface CourtState {
  id: number; // 1-based
  status: 'ready' | 'live';
  teamA: string[]; // player ids
  teamB: string[];
  startedAt: number | null;
}

export interface UpNextMatch {
  id: string;
  auto: boolean;
  teamA: string[];
  teamB: string[];
}

export interface LoggedMatch {
  id: string;
  court: number;
  winners: string[];
  losers: string[];
  at: number;
  durationSec: number | null;
}

export interface Session {
  id: string;
  name: string;
  courts: number;
  format: Format; // doubles-only UI; kept for scheduler
  showLiveStandings: boolean;
  matchingMode: MatchingMode;
  players: Player[];
  courtStates: CourtState[];
  upNext: UpNextMatch[];
  matchLog: LoggedMatch[];
  startedAt: number | null;
  endedAt: number | null;
  matchDurationsSec: number[];
}

export const MODES: { id: MatchingMode; label: string; desc: string; tag?: string; tagCls?: string }[] = [
  {
    id: 'openplay', label: 'Open Play',
    desc: 'Random pairing every match. Fair rotation so everyone ends the session with roughly the same court time.',
    tag: 'Recommended', tagCls: 'tag-rec',
  },
  {
    id: 'normal', label: 'Normal',
    desc: 'Free-form. Locked-in pairs stay together; everyone else gets filled in at random. Anything goes.',
  },
  {
    id: 'skillpairs', label: 'Skill Pairs',
    desc: 'Paired by skill level. Winners rotate up to face stronger players; losers rotate down. Keeps every game competitive.',
  },
];

export const SKILL_LABELS = ['—', 'Beginner', 'Beginner+', 'Intermediate', 'Intermediate+', 'Advanced', 'Advanced+'];

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
