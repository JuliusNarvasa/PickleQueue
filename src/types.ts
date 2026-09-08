// Core domain types — local session only (no backend).
export type Format = 'doubles' | 'singles';
export type MatchingMode =
  | 'balanced' | 'social' | 'skill-separated' | 'winners-losers'
  | 'skill-courts' | 'mixed-doubles' | 'king-queen' | 'club-wars' | 'tournament';

export interface Player {
  id: string;
  name: string;
  skill: number | null; // 1-6 stars
  gender: 'M' | 'F' | null;
  checkedIn: boolean;
  gamesPlayed: number;
  wins: number;
  losses: number;
  waitStartedAt: number; // epoch ms — queue order tiebreak
  checkedInAt: number | null;
  presentMinutes: number;
  lockedPartnerId: string | null;
  recentPartners: string[];
  recentOpponents: string[];
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
  format: Format;
  gameLimit: number | null;
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

export const MODES: { id: MatchingMode; label: string; desc: string; tag?: string; tagCls?: string; hidden?: boolean }[] = [
  { id: 'balanced', label: 'Balanced', desc: 'Balances teams by rating. Avoids repeat matchups when possible.', tag: 'RECOMMENDED', tagCls: 'rec' },
  { id: 'social', label: 'Social Mix', desc: 'Rotates partners before repeating, then spreads opponents as fairly as possible. Ratings aren’t used.', tag: 'IMPROVED', tagCls: 'imp' },
  { id: 'skill-separated', label: 'Skill Separated', desc: 'Keeps similar skill levels together. May leave a court waiting.' },
  { id: 'winners-losers', label: 'Winners / Losers', desc: 'Winners play winners and losers play losers. PickleQ rotates between both groups.' },
  { id: 'skill-courts', label: 'Skill Courts', desc: 'Per-group courts + queue', hidden: true },
  { id: 'mixed-doubles', label: 'Mixed Doubles', desc: '1M + 1F per team', hidden: true },
  { id: 'king-queen', label: 'King / Queen of the Court', desc: 'Winners move up, losers move down', hidden: true },
  { id: 'club-wars', label: 'Club Wars', desc: 'Team A vs Team B (beta)', hidden: true },
  { id: 'tournament', label: 'Tournament', desc: 'Fixed teams + schedule, doubles only', hidden: true },
];

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
