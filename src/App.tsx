import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CourtState, LoggedMatch, MatchingMode, MODES, Player, Session, SKILL_LABELS, UpNextMatch, uid,
} from './types';
import { applyResult, buildUpNext, fairPool, rankStandings, spread } from './scheduler';
import { loadSession, saveSession } from './storage';
import { trackPlay } from './tracking';

type Route = 'landing' | 'setup' | 'roster' | 'live' | 'complete' | 'tracking' | 'notfound';
type Toast = { msg: string; undo?: () => void } | null;

function emptySession(): Session {
  return {
    id: uid(), name: 'Tuesday Open Play', courts: 2, format: 'doubles',
    showLiveStandings: true, matchingMode: 'openplay',
    players: [], courtStates: [], upNext: [], matchLog: [],
    startedAt: null, endedAt: null, matchDurationsSec: [],
  };
}

function newPlayer(name: string, skill: number | null = null): Player {
  const now = Date.now();
  return {
    id: uid(), name, skill, checkedIn: false,
    gamesPlayed: 0, wins: 0, losses: 0, waitStartedAt: now,
    checkedInAt: null, lockedPartnerId: null,
    recentPartners: [], recentOpponents: [],
    firstPlayedAt: null, lastPlayedAt: null,
  };
}

function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtMMSS(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function useNow(stepMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

/* Brand icon: court + ball, matches public/icon.svg */
function BrandIcon() {
  return (
    <svg className="brand-icon" viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <linearGradient id="pq-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill="url(#pq-bg)" />
      <rect x="6" y="11" width="24" height="14" rx="2" fill="none" stroke="white" strokeWidth="0.9" opacity="0.45" />
      <line x1="18" y1="11" x2="18" y2="25" stroke="white" strokeWidth="0.7" opacity="0.45" />
      <line x1="6" y1="18" x2="30" y2="18" stroke="white" strokeWidth="0.5" opacity="0.3" />
      <circle cx="18" cy="18" r="5.5" fill="white" />
      <circle cx="18" cy="15.5" r="0.7" fill="#15803d" />
      <circle cx="15.5" cy="18" r="0.7" fill="#15803d" />
      <circle cx="20.5" cy="18" r="0.7" fill="#15803d" />
      <circle cx="18" cy="20.5" r="0.7" fill="#15803d" />
    </svg>
  );
}

/* Check / X glyphs used by icon buttons and sheets */
function XIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}
function XSmall() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

function stars(n: number, max = 6) {
  return '★'.repeat(Math.min(Math.max(n, 0), max)) + '☆'.repeat(Math.max(0, max - Math.min(Math.max(n, 0), max)));
}

function StarSvg({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <svg className={`star-btn${on ? ' is-on' : ''}`} viewBox="0 0 16 16"
      fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4"
      onClick={onClick} style={{ cursor: 'pointer' }} aria-hidden="true">
      <path d="M8 1.5l1.95 4.2 4.55.5-3.4 3.1.95 4.5L8 11.7l-4.05 2.1.95-4.5-3.4-3.1 4.55-.5L8 1.5z" />
    </svg>
  );
}

function medalSVG(rank: number) {
  const palettes: Record<number, { bg: string; border: string; hl: string; num: string }> = {
    1: { bg: '#fbbf24', border: '#b45309', hl: '#fef9c3', num: '#78350f' },
    2: { bg: '#e5e7eb', border: '#6b7280', hl: '#ffffff', num: '#1f2937' },
    3: { bg: '#b45309', border: '#78350f', hl: '#fde68a', num: '#fef3c7' },
  };
  const c = palettes[rank];
  if (!c) {
    return (
      <svg viewBox="0 0 24 24" width="28" height="28" className="medal-icon" aria-hidden="true">
        <circle cx="12" cy="13" r="6" fill="#f3f4f6" stroke="#d1d5db" strokeWidth="0.7" />
        <text x="12" y="15.4" textAnchor="middle" fontSize="5.5" fontWeight="800"
          fontFamily="ui-monospace,SFMono-Regular,monospace" fill="#6b7280">{rank}</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" className="medal-icon" aria-hidden="true">
      <path d="M8 1 L11 1 L12.5 11 L9.5 11 Z" fill="#dc2626" />
      <path d="M16 1 L13 1 L11.5 11 L14.5 11 Z" fill="#b91c1c" />
      <circle cx="12" cy="15" r="6" fill={c.bg} stroke={c.border} strokeWidth="0.6" />
      <ellipse cx="9.8" cy="12.5" rx="1.5" ry="1" fill={c.hl} opacity="0.55" />
      <circle cx="12" cy="15" r="4.6" fill="none" stroke={c.border} strokeWidth="0.35" opacity="0.5" />
      <text x="12" y="17" textAnchor="middle" fontSize="5.5" fontWeight="800"
        fontFamily="ui-monospace,SFMono-Regular,monospace" fill={c.num}>{rank}</text>
    </svg>
  );
}

/* Rebuild staged matches from the fair head (seated excluded).
 * Called after every state change that affects availability:
 * send-to-court, result recorded, late check-in. Lowest game count
 * always lands on top, so late arrivals flow in immediately. */
function restage(s: Session): Session {
  const seated = new Set(s.courtStates.flatMap((c) => [...c.teamA, ...c.teamB]));
  const readyCount = s.courtStates.filter((c) => c.status === 'ready').length;
  if (readyCount === 0) return { ...s, upNext: [] };
  const built = buildUpNext(s.players, seated, s.matchingMode, s.format, readyCount);
  return { ...s, upNext: built.map((m) => ({ id: uid(), auto: true, ...m })) };
}

export default function App() {
  const [route, setRoute] = useState<Route>('landing');
  const [session, setSession] = useState<Session>(() => loadSession() ?? emptySession());
  const [toast, setToast] = useState<Toast>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => { saveSession(session); }, [session]);
  // Resume: if a live session was persisted, jump to live view.
  useEffect(() => {
    const s = loadSession();
    if (s && s.startedAt && !s.endedAt && s.courtStates.length > 0) setRoute('live');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tracking page route (token-gated). /tracking or /tracking/<token>
  useEffect(() => {
    if (window.location.pathname.toLowerCase().startsWith('/tracking')) setRoute('tracking');
  }, []);

  const flash = (msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const update = (fn: (s: Session) => Session) => setSession((s) => fn({ ...s }));

  const startPlay = () => {
    const courts: CourtState[] = Array.from({ length: session.courts }, (_, i) => ({
      id: i + 1, status: 'ready', teamA: [], teamB: [], startedAt: null,
    }));
    const base: Session = {
      ...session, courtStates: courts, upNext: [], matchLog: [],
      startedAt: Date.now(), endedAt: null, matchDurationsSec: [],
    };
    setSession(restage(base));
    setRoute('live');
  };

  const shellClass =
    route === 'landing' || route === 'complete' ? 'app no-footer'
    : route === 'live' ? 'app with-chips' : 'app with-stepper';

  return (
    <div className={shellClass}>
      {route !== 'landing' && route !== 'complete' ? (
        <LiveHeader route={route} session={session} onEnd={() => setConfirmEnd(true)} />
      ) : (
        <header className="header">
          <div className="header-row1">
            <div className="brand"><BrandIcon /><span className="brand-name">PickleQueue</span></div>
          </div>
        </header>
      )}

      {route === 'landing' && <LandingScreen go={setRoute} />}
      {route === 'setup' && (
        <SetupScreen session={session} update={update} go={setRoute} />
      )}
      {route === 'roster' && (
        <RosterScreen session={session} update={update} go={setRoute} flash={flash} onStart={startPlay} />
      )}
      {route === 'live' && (
        <LiveScreen session={session} setSession={setSession} flash={flash} go={setRoute} />
      )}
      {route === 'tracking' && <TrackingScreen />}
      {route === 'notfound' && <NotFoundScreen />}
      {route === 'complete' && (
        <CompleteScreen session={session} setSession={setSession} go={setRoute} />
      )}

      {toast && (
        <div className="toast is-open" role="status" aria-live="polite">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}
          <button className="toast-x" onClick={() => setToast(null)} aria-label="Dismiss"><XSmall /></button>
        </div>
      )}

      {confirmEnd && (
        <>
          <div className="scrim is-open" onClick={() => setConfirmEnd(false)} />
          <div className="dialog is-open" role="dialog" aria-modal="true">
            <h2>End session?</h2>
            <p>This will finalize the leaderboard. This can&apos;t be undone.</p>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmEnd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                setConfirmEnd(false);
                setSession((s) => ({ ...s, endedAt: Date.now() }));
                setRoute('complete');
              }}>End session</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function queueCount(s: Session) {
  const seated = new Set(s.courtStates.flatMap((c) => [...c.teamA, ...c.teamB]));
  const staged = new Set(s.upNext.flatMap((m) => [...m.teamA, ...m.teamB]));
  return s.players.filter((p) => p.checkedIn && !seated.has(p.id) && !staged.has(p.id)).length;
}

function skillLabel(skill: number | null) {
  return skill == null ? 'Unrated' : SKILL_LABELS[skill] ?? '—';
}

/* ---------------- Header ---------------- */
function LiveHeader({ route, session, onEnd }: {
  route: Route; session: Session; onEnd: () => void;
}) {
  const live = session.courtStates.filter((c) => c.status === 'live').length;
  const checkedIn = session.players.filter((p) => p.checkedIn).length;
  if (route === 'live') {
    return (
      <header className="header">
        <div className="header-row1">
          <div className="brand"><BrandIcon /><span className="brand-name">PickleQueue</span></div>
        </div>
        <div className="header-row2">
          <span className="chip"><span className="chip-label">Mode</span><span className="chip-val">{MODES.find((m) => m.id === session.matchingMode)?.label}</span></span>
          <span className="chip"><span className="chip-label">Session</span><span className="chip-val">{session.name}</span></span>
          <span className="chip"><span className="chip-label">Courts</span><span className="chip-val">{live}/{session.courtStates.length}</span></span>
          <span className="chip"><span className="chip-label">Players</span><span className="chip-val">{checkedIn}</span></span>
          <span className="chip"><span className="chip-label">Queue</span><span className="chip-val">{queueCount(session)}</span></span>
        </div>
      </header>
    );
  }
  // setup / roster: brand + numbered stepper
  const step = route === 'setup' ? 1 : 2;
  return (
    <header className="header">
      <div className="header-row1">
        <div className="brand"><BrandIcon /><span className="brand-name">PickleQueue</span></div>
      </div>
      <div className="stepper">
        <span className={`step${step > 1 ? ' is-done' : step === 1 ? ' is-active' : ''}`}>
          <span className="step-num">{step > 1 ? '✓' : '1'}</span>SET UP SESSION
        </span>
        <span className="step-sep" />
        <span className={`step${step === 2 ? ' is-active' : ''}`}>
          <span className="step-num">2</span>ADD PLAYERS
        </span>
        <span className="step-sep" />
        <span className="step"><span className="step-num">3</span>START</span>
      </div>
    </header>
  );
  void onEnd;
}

/* ---------------- Landing ---------------- */
function LandingScreen({ go }: { go: (r: Route) => void }) {
  return (
    <main className="content">
      <section className="hero-card">
        <p className="eyebrow">OPEN PLAY · NO SIGNUP</p>
        <h1>Set up open play in 60 seconds</h1>
        <p className="hero-sub">Works offline · Free · Courts 1–64</p>
      </section>

      <section style={{ marginBottom: 16 }}>
        <button className="option-card" onClick={() => go('setup')}>
          <h3>I organize open play</h3>
          <p className="opt-sub">Run courts, balance teams, track standings. Free forever.</p>
        </button>
      </section>

      <section className="tutorial-card">
        <h2>How PickleQueue works</h2>
        <p className="tut-intro">Everything you need to run fair, flowing open play.</p>
        <div className="tut-list">
          {[
            ['Set up in 60 seconds', "Pick how many courts, name your session, choose a matching mode. That's it."],
            ['Check in players', 'Add names or import a list. Tap stars to rate skill. Lock pair partners who always play together.'],
            ['Auto-pair matches', 'Up next is staged for you. Send to court, tap the winning team, repeat.'],
            ['Live standings & logs', 'Win %, games played, and full match history update with every result. Spread stays tight.'],
            ['Wrap up cleanly', 'End the session for final standings and a participation summary. Start a new one in seconds.'],
          ].map(([t, d], i) => (
            <div className="tut-item" key={i}>
              <span className="tut-num">{i + 1}</span>
              <div className="tut-body">
                <div className="tut-title">{t}</div>
                <div className="tut-desc">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="muted" style={{ textAlign: 'center', marginTop: 24, fontSize: 12 }}>v1.0 · Made for rec play</p>
    </main>
  );
}

/* ---------------- Setup wizard ---------------- */
function SetupScreen({ session, update, go }: {
  session: Session; update: (fn: (s: Session) => Session) => void; go: (r: Route) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(session.name);

  return (
    <>
      <main className="content">
        <section className="card">
          <div className="card-title"><h2>Courts</h2></div>
          <div className="stepper-ctrl">
            <button className="stepper-btn" aria-label="Remove court"
              disabled={session.courts <= 1}
              onClick={() => update((s) => ({ ...s, courts: Math.max(1, s.courts - 1) }))}>−</button>
            <span className="stepper-val">{session.courts}</span>
            <button className="stepper-btn" aria-label="Add court"
              disabled={session.courts >= 64}
              onClick={() => update((s) => ({ ...s, courts: Math.min(64, s.courts + 1) }))}>+</button>
            <span className="muted" style={{ marginLeft: 6 }}>courts in use</span>
          </div>
        </section>

        <section className="card">
          <div className="card-title"><h2>Session name</h2></div>
          {editingName ? (
            <input className="input" value={nameDraft} autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                update((s) => ({ ...s, name: nameDraft.trim() || s.name }));
                setEditingName(false);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <div className="inline-name" onClick={() => { setNameDraft(session.name); setEditingName(true); }}>
              <span>{session.name}</span>
              <svg className="pencil" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M11.5 2.5l2 2-8 8-2.5.5.5-2.5 8-8z" />
              </svg>
            </div>
          )}
        </section>

        <section className="card">
          <label className="checkbox">
            <input type="checkbox" checked={session.showLiveStandings}
              onChange={(e) => update((s) => ({ ...s, showLiveStandings: e.target.checked }))} />
            <span className="box" />
            <span className="lbl">Show live standings</span>
            <span className="sub">recommended</span>
          </label>
        </section>

        <section className="card">
          <div className="card-title"><h2>Matching mode</h2></div>
          <div className="mode-grid">
            {MODES.map((m) => (
              <div key={m.id} role="button" tabIndex={0} aria-pressed={session.matchingMode === m.id}
                className={`mode-card${session.matchingMode === m.id ? ' is-selected' : ''}`}
                onClick={() => update((s) => ({ ...s, matchingMode: m.id as MatchingMode }))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); update((s) => ({ ...s, matchingMode: m.id as MatchingMode })); } }}>
                {m.tag && <span className={`mode-tag tag ${m.tagCls ?? ''}`}>{m.tag}</span>}
                <span className="mode-name">{m.label}</span>
                <span className="mode-sub">{m.desc}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <nav className="footer-bar">
        <button className="btn btn-secondary" onClick={() => go('landing')}>← Back</button>
        <button className="btn btn-primary btn-big" onClick={() => go('roster')}>Continue to players →</button>
      </nav>
    </>
  );
}

/* ---------------- Roster ---------------- */
function RosterScreen({ session, update, go, flash, onStart }: {
  session: Session; update: (fn: (s: Session) => Session) => void; go: (r: Route) => void;
  flash: (msg: string, undo?: () => void) => void; onStart: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [pairSource, setPairSource] = useState<string | null>(null);

  const addName = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    update((s) => ({ ...s, players: [...s.players, newPlayer(name, 3)] }));
    setDraft('');
  };

  const checkedIn = session.players.filter((p) => p.checkedIn).length;
  const need = 4; // doubles-only UI
  const ready = checkedIn >= need;

  const checkIn = (id: string, v: boolean) => {
    const now = Date.now();
    update((s) => ({
      ...s,
      players: s.players.map((p) => p.id === id
        ? { ...p, checkedIn: v, checkedInAt: v ? now : p.checkedInAt, waitStartedAt: v ? now : p.waitStartedAt }
        : p),
    }));
    if (v) flash('Checked in');
  };

  const byId = useMemo(() => new Map(session.players.map((p) => [p.id, p])), [session.players]);
  const sourcePlayer = pairSource ? byId.get(pairSource) : null;
  const pairCandidates = session.players.filter((q) => q.checkedIn && q.id !== pairSource && !q.lockedPartnerId);

  return (
    <>
      <main className="content">
        <section className="card">
          <div className="field-row">
            <input className="input" placeholder="Type a name and press Add" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addName(draft); }} />
            <button className="btn btn-primary" onClick={() => addName(draft)}>Add</button>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
            New players start unchecked — they&apos;ll appear under &ldquo;Not yet here&rdquo;.
          </p>
        </section>

        <div style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" style={{ width: '100%' }}
            onClick={() => update((s) => ({
              ...s,
              players: s.players.map((p) => ({ ...p, checkedIn: true, checkedInAt: p.checkedInAt ?? Date.now() })),
            }))}>
            Check in all
          </button>
        </div>

        <section className="card" style={{ marginTop: 12 }}>
          <div className="group-label"><span>Checked in</span><span className="count">{checkedIn}</span></div>
          <div>
            {session.players.filter((p) => p.checkedIn).map((p) => {
              const mate = p.lockedPartnerId ? byId.get(p.lockedPartnerId) : null;
              return (
                <div className="player-row" key={p.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span className="pname">{p.name}</span>
                      <button className="btn-icon" aria-label={`Check out ${p.name}`} onClick={() => checkIn(p.id, false)}>
                        <XSmall />
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                      <div className="stars">
                        {[1, 2, 3, 4, 5, 6].map((s) => (
                          <StarSvg key={s} on={p.skill != null && s <= p.skill}
                            onClick={() => update((st) => ({
                              ...st,
                              players: st.players.map((q) => q.id === p.id ? { ...q, skill: p.skill === s ? null : s } : q),
                            }))} />
                        ))}
                      </div>
                      <span className="pskill">{skillLabel(p.skill)}</span>
                      {mate && (
                        <span className="pair-lock">
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M6 8h4M5.5 5.5a2.5 2.5 0 010 5M10.5 5.5a2.5 2.5 0 010 5" />
                          </svg>
                          w/ {mate.name}
                        </span>
                      )}
                      <button className="btn btn-secondary"
                        style={{ minHeight: 30, padding: '0 12px', fontSize: 12 }}
                        onClick={() => {
                          if (mate) {
                            update((st) => ({
                              ...st,
                              players: st.players.map((q) =>
                                q.lockedPartnerId === p.id ? { ...q, lockedPartnerId: null }
                                : q.id === p.id ? { ...q, lockedPartnerId: null } : q),
                            }));
                          } else setPairSource(p.id);
                        }}>
                        {mate ? 'Unpair' : 'Pair…'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card" style={{ marginTop: 12 }}>
          <div className="group-label">
            <span>Not yet here</span>
            <span className="count">{session.players.filter((p) => !p.checkedIn).length}</span>
          </div>
          <div>
            {session.players.filter((p) => !p.checkedIn).map((p) => (
              <div className="player-row" key={p.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span className="pname" style={{ color: 'var(--muted)' }}>{p.name}</span>
                    <button className="btn-icon" aria-label={`Remove ${p.name}`}
                      onClick={() => update((s) => ({ ...s, players: s.players.filter((q) => q.id !== p.id) }))}>
                      <XSmall />
                    </button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 14px', fontSize: 13 }}
                      onClick={() => checkIn(p.id, true)}>Check in</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <nav className="footer-bar">
        <button className="btn btn-secondary" onClick={() => go('setup')}>← Back</button>
        <button className="btn btn-primary btn-big" disabled={!ready} onClick={onStart}
          title={ready ? '' : `Need ${need} checked in`}>
          START PLAY {ready ? `(${checkedIn})` : `(${checkedIn}/${need})`}
        </button>
      </nav>

      {/* Pair bottom sheet */}
      {pairSource && (
        <>
          <div className="scrim is-open" onClick={() => setPairSource(null)} />
          <aside className="sheet is-open" aria-hidden="false">
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>Pair {sourcePlayer?.name ?? ''} with…</h2>
                <p className="muted" style={{ fontSize: 12.5 }}>Tap a checked-in player to lock as a pair partner.</p>
              </div>
              <button className="btn-icon" aria-label="Close" onClick={() => setPairSource(null)}><XIcon /></button>
            </div>
            <div className="sheet-body">
              <div className="player-list">
                {pairCandidates.length === 0 && (
                  <div className="empty">No one to pair with right now. Check more players in first.</div>
                )}
                {pairCandidates.map((c) => (
                  <button className="player-pick" type="button" key={c.id}
                    onClick={() => {
                      update((st) => ({
                        ...st,
                        players: st.players.map((q) =>
                          q.id === pairSource ? { ...q, lockedPartnerId: c.id }
                          : q.id === c.id ? { ...q, lockedPartnerId: pairSource } : q),
                      }));
                      setPairSource(null);
                      flash('Pair locked');
                    }}>
                    <span className="pname">{c.name}</span>
                    <span className="pstars">{stars(c.skill ?? 3)}</span>
                    <span className="pskill">{skillLabel(c.skill)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="sheet-foot">
              <button className="btn btn-secondary" onClick={() => setPairSource(null)}>Cancel</button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

/* ---------------- Live court view ---------------- */
function LiveScreen({ session, setSession, flash, go }: {
  session: Session; setSession: React.Dispatch<React.SetStateAction<Session>>;
  flash: (msg: string, undo?: () => void) => void; go: (r: Route) => void;
}) {
  const now = useNow(1000);
  const [chooseCourt, setChooseCourt] = useState<number | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [lateOpen, setLateOpen] = useState(false);
  const [lateName, setLateName] = useState('');
  const [lateSkill, setLateSkill] = useState(3);
  const [playersOpen, setPlayersOpen] = useState(false);
  const byId = useMemo(() => new Map(session.players.map((p) => [p.id, p])), [session.players]);
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';
  const seated = useMemo(() => new Set(session.courtStates.flatMap((c) => [...c.teamA, ...c.teamB])), [session]);
  const stagedIds = useMemo(() => new Set(session.upNext.flatMap((m) => [...m.teamA, ...m.teamB])), [session.upNext]);
  const statsOf = (id: string) => byId.get(id);
  const recOf = (p: Player) => `${p.wins}-${p.losses} · ${p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0}%`;

  const avgMatchSec = session.matchDurationsSec.length
    ? Math.round(session.matchDurationsSec.reduce((a, b) => a + b, 0) / session.matchDurationsSec.length)
    : 600;

  const recordOf = (p: Player) => `${p.wins}-${p.losses}`;

  const sendToCourt = (matchId: string, courtId: number) => {
    setSession((prev) => {
      const m = prev.upNext.find((x) => x.id === matchId);
      const court = prev.courtStates.find((c) => c.id === courtId);
      if (!m || !court || court.status === 'live') return prev;
      const next: Session = {
        ...prev,
        courtStates: prev.courtStates.map((c) => c.id === courtId
          ? { ...c, status: 'live' as const, teamA: m.teamA, teamB: m.teamB, startedAt: Date.now() } : c),
        upNext: prev.upNext.filter((x) => x.id !== matchId),
      };
      return restage(next);
    });
  };

  const recordWin = (court: CourtState, winner: 'A' | 'B') => {
    const winners = winner === 'A' ? court.teamA : court.teamB;
    const wnames = winners.map(nameOf).join(' + ');
    const dur = court.startedAt ? Math.round((Date.now() - court.startedAt) / 1000) : null;
    const snapshot = session.players;
    const logEntry: LoggedMatch = {
      id: uid(), court: court.id,
      winners: [...winners],
      losers: [...(winner === 'A' ? court.teamB : court.teamA)],
      at: Date.now(), durationSec: dur,
    };
    setSession((prev) => {
      const players = applyResult(prev.players, court.teamA, court.teamB, winner);
      const next: Session = {
        ...prev,
        players,
        courtStates: prev.courtStates.map((c) => c.id === court.id
          ? { ...c, status: 'ready' as const, teamA: [], teamB: [], startedAt: null } : c),
        matchLog: [...prev.matchLog, logEntry],
        matchDurationsSec: dur != null ? [...prev.matchDurationsSec, dur] : prev.matchDurationsSec,
      };
      return restage(next);
    });
    // Silent tracking: who played on this court. Fire-and-forget; never disrupts queuing.
    try {
      const playedNames = [...court.teamA, ...court.teamB].map(nameOf);
      trackPlay(playedNames);
    } catch { /* swallow */ }
    flash(`Match logged · ${wnames} won`, () => {
      setSession((prev) => restage({
        ...prev,
        players: snapshot,
        matchLog: prev.matchLog.filter((l) => l.id !== logEntry.id),
        courtStates: prev.courtStates.map((c) => c.id === court.id
          ? { ...c, status: 'live' as const, teamA: court.teamA, teamB: court.teamB, startedAt: court.startedAt } : c),
      }));
    });
  };

  const swapWinner = (log: LoggedMatch) => {
    setSession((prev) => {
      const players = prev.players.map((p) => {
        if (log.winners.includes(p.id)) return { ...p, wins: p.wins - 1, losses: p.losses + 1 };
        if (log.losers.includes(p.id)) return { ...p, wins: p.wins + 1, losses: p.losses - 1 };
        return p;
      });
      return {
        ...prev, players,
        matchLog: prev.matchLog.map((l) => l.id === log.id
          ? { ...l, winners: [...l.losers], losers: [...l.winners] } : l),
      };
    });
    flash('Winner swapped');
  };

  /* Check-in queue: lowest games first; late (0-game) arrivals on top with "Just in". */
  const queue = fairPool(session.players).filter((p) => !seated.has(p.id) && !stagedIds.has(p.id));
  void avgMatchSec;

  const commitLate = () => {
    const name = lateName.trim();
    if (!name) return;
    const np = { ...newPlayer(name, lateSkill), checkedIn: true, checkedInAt: Date.now(), waitStartedAt: Date.now() };
    setSession((prev) => restage({
      ...prev,
      players: [...prev.players, np],
    }));
    setLateName(''); setLateSkill(3); setLateOpen(false);
    flash(`${name} added — playing next`);
  };

  const confirmChoose = () => {
    if (chooseCourt == null || chosen.length !== 4) return;
    const teamA = [chosen[0], chosen[1]];
    const teamB = [chosen[2], chosen[3]];
    const cid = chooseCourt;
    setSession((prev) => restage({
      ...prev,
      courtStates: prev.courtStates.map((c) => c.id === cid
        ? { ...c, status: 'live' as const, teamA, teamB, startedAt: Date.now() } : c),
      upNext: prev.upNext.filter((m) => ![...teamA, ...teamB].some((id) => [...m.teamA, ...m.teamB].includes(id))),
    }));
    setChooseCourt(null);
    setChosen([]);
  };

  // Live standings: competition rank, ties share rank.
  const ranked = useMemo(() => {
    const rows = rankStandings(session.players)
      .map((p) => ({ p, pct: p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0 }));
    let prevKey: string | null = null;
    let prevRank = 0;
    return rows.map((r, i) => {
      const key = `${r.pct}-${r.p.wins}-${r.p.losses}`;
      if (key !== prevKey) { prevRank = i + 1; prevKey = key; }
      return { ...r, rank: prevRank };
    }).slice(0, 10);
  }, [session.players]);
  const showMedals = ranked.length > 0 && ranked[0].p.gamesPlayed > 0;

  const playersByGames = useMemo(() =>
    [...session.players]
      .filter((p) => p.checkedIn)
      .map((p) => ({ p, pct: p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0 }))
      .sort((a, b) => a.p.gamesPlayed - b.p.gamesPlayed || b.pct - a.pct || a.p.name.localeCompare(b.p.name)),
  [session.players]);

  return (
    <>
      <main className="content">
        <section className="section">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2>Live courts</h2>
            <button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 12px', fontSize: 13 }}
              onClick={() => setSession((prev) => {
                if (prev.courtStates.length >= 64) return prev;
                return {
                  ...prev, courts: prev.courts + 1,
                  courtStates: [...prev.courtStates, {
                    id: Math.max(0, ...prev.courtStates.map((c) => c.id)) + 1,
                    status: 'ready' as const, teamA: [], teamB: [], startedAt: null,
                  }],
                };
              })}>+ Add court</button>
          </div>
          <div className="court-grid">
            {session.courtStates.map((c) => (
              <div key={c.id} className={`court-card${c.status === 'live' ? ' is-live' : ' is-ready'}`}>
                <div className="court-head">
                  <span className="court-name">Court {c.id}</span>
                  {c.status === 'live' ? (
                    <span className="court-badge live">LIVE
                      <span className="mono" style={{ marginLeft: 4, opacity: 0.9 }}>
                        {c.startedAt ? fmtMMSS(Math.max(0, Math.round((now - c.startedAt) / 1000))) : ''}
                      </span>
                    </span>
                  ) : (
                    <span className="court-badge ready">Ready</span>
                  )}
                </div>
                {c.status === 'live' ? (
                  <>
                    <div className="court-vs">
                      <div className="team">
                        <span className="team-name">Team 1</span>
                        <span className="team-names">{c.teamA.map(nameOf).join(' · ')}</span>
                        <span className="team-record">{c.teamA.map((id) => statsOf(id)).filter(Boolean).map((p) => recordOf(p!)).join(' / ')}</span>
                      </div>
                      <span className="vs-sep">vs</span>
                      <div className="team" style={{ textAlign: 'right' }}>
                        <span className="team-name">Team 2</span>
                        <span className="team-names">{c.teamB.map(nameOf).join(' · ')}</span>
                        <span className="team-record">{c.teamB.map((id) => statsOf(id)).filter(Boolean).map((p) => recordOf(p!)).join(' / ')}</span>
                      </div>
                    </div>
                    <div className="court-actions">
                      <button className="btn btn-primary" onClick={() => recordWin(c, 'A')}>Team 1 wins</button>
                      <button className="btn btn-primary" onClick={() => recordWin(c, 'B')}>Team 2 wins</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ fontSize: 13, margin: '8px 0 12px' }}>No players assigned. Pick 4 to start.</p>
                    <button className="btn btn-secondary" style={{ width: '100%' }}
                      onClick={() => { setChooseCourt(c.id); setChosen([]); }}>Choose players</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2>Up next <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>(auto)</span></h2>
            <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{session.upNext.length} staged</span>
          </div>
          {session.upNext.length === 0 && (
            <div className="empty">No matches staged — everyone is playing or queue is short.</div>
          )}
          <div className="stack" style={{ gap: 8 }}>
            {session.upNext.map((m) => {
              const ready = session.courtStates.filter((c) => c.status === 'ready');
              const target = ready[0];
              return (
                <div key={m.id} className="staged-card">
                  <div className="matchup">
                    <div className="matchup-top">
                      {m.teamA.map(nameOf).join(' + ')} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>vs</span> {m.teamB.map(nameOf).join(' + ')}
                    </div>
                    <div className="matchup-names">{target ? `→ Court ${target.id} next` : 'No court free'}</div>
                  </div>
                  <span className="mode-mini">{m.auto ? 'AUTO' : 'MANUAL'}</span>
                  <button className="btn-icon" aria-label="Remove staged match"
                    onClick={() => setSession((prev) => ({ ...prev, upNext: prev.upNext.filter((x) => x.id !== m.id) }))}>
                    <XSmall />
                  </button>
                  {target && (
                    <button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
                      onClick={() => sendToCourt(m.id, target.id)}>Send to {target.id}</button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <h2>Check-in queue <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 13 }}>({queue.length})</span></h2>
            <button className="btn btn-primary" style={{ minHeight: 32, padding: '0 12px', fontSize: 13 }}
              onClick={() => setLateOpen(true)}>+ Check in player</button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>Late arrivals jump to the front of the line.</p>
          {queue.length === 0 ? (
            <div className="empty">Queue is empty — everyone is playing or staged.</div>
          ) : (
            <div className="queue-list">
              {queue.map((p, i) => {
                const late = p.gamesPlayed === 0;
                return (
                  <div key={p.id} className={`queue-row${late ? ' is-late' : ''}`}>
                    <span className="qrank">{i + 1}</span>
                    <div className="qmain">
                      <div className="qline1">
                        <strong>{p.name}</strong>
                        {late && <span className="tag-justin">Just in</span>}
                      </div>
                      <div className="qline2">
                        <span className="qstars">{stars(p.skill ?? 3)}</span>
                        <span className="qmeta">{p.gamesPlayed} g</span>
                      </div>
                    </div>
                    <button className="btn-icon" aria-label={`Check out ${p.name}`}
                      onClick={() => setSession((prev) => ({
                        ...prev,
                        players: prev.players.map((q) => q.id === p.id ? { ...q, checkedIn: false } : q),
                      }))}>
                      <XSmall />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {session.showLiveStandings && (
          <section className="section">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <h2>Live standings</h2>
              <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>top 10</span>
            </div>
            <table className="std-table">
              <thead><tr><th>#</th><th>Name</th><th className="num-col">Games</th><th className="pct-col">W%</th></tr></thead>
              <tbody>
                {ranked.map(({ p, pct, rank }) => (
                  <tr key={p.id}>
                    <td className="rank">{medalSVG(showMedals ? rank : 0)}</td>
                    <td><strong>{p.name}</strong></td>
                    <td className="num-col">{p.gamesPlayed}</td>
                    <td className="pct-col" style={{ color: pct >= 50 ? 'var(--accent)' : 'var(--muted)' }}>{pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="section">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2>Match log</h2>
            <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{session.matchLog.length} finished</span>
          </div>
          <div>
            {[...session.matchLog].reverse().map((l) => (
              <div key={l.id} className="log-row-app">
                <span className="lnum">#{session.matchLog.findIndex((x) => x.id === l.id) + 1}</span>
                <span className="lct">CT{l.court}</span>
                <div className="lmatch">
                  <strong>WIN</strong> {l.winners.map(nameOf).join(' + ')}<br />
                  <span><strong>LOSE</strong> {l.losers.map(nameOf).join(' + ')}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span className="ltime">{new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  <button className="btn btn-secondary" style={{ minHeight: 28, padding: '0 10px', fontSize: 11.5 }}
                    onClick={() => swapWinner(l)}>Swap winner</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <nav className="footer-bar">
        <button className="btn btn-secondary" onClick={() => setPlayersOpen(true)}>
          Players · spread {spread(session.players)}
        </button>
        <button className="btn btn-primary" data-testid="end-session" onClick={() => {
          setSession((s) => ({ ...s, endedAt: Date.now() }));
          go('complete');
        }}>
          End
        </button>
      </nav>

      {/* Choose-players sheet */}
      {chooseCourt != null && (
        <>
          <div className="scrim is-open" onClick={() => { setChooseCourt(null); setChosen([]); }} />
          <aside className="sheet is-open" aria-hidden="false">
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>Court {chooseCourt} · Choose players</h2>
                <p className="muted" style={{ fontSize: 12.5 }}>Doubles · pick exactly 4</p>
              </div>
              <button className="btn-icon" aria-label="Close" onClick={() => { setChooseCourt(null); setChosen([]); }}><XIcon /></button>
            </div>
            <div className="sheet-body">
              {fairPool(session.players).filter((p) => !seated.has(p.id)).map((p) => (
                <label className="checkbox" style={{ padding: '10px 0' }} key={p.id}>
                  <input type="checkbox" checked={chosen.includes(p.id)}
                    onChange={() => setChosen((c) => {
                      if (c.includes(p.id)) return c.filter((x) => x !== p.id);
                      if (c.length >= 4) return c;
                      return [...c, p.id];
                    })} />
                  <span className="box" />
                  <span className="lbl"><strong>{p.name}</strong>{' '}
                    <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 12 }}>· {stars(p.skill ?? 3)}</span>
                  </span>
                  <span className="sub">{p.gamesPlayed} games</span>
                </label>
              ))}
            </div>
            <div className="sheet-foot">
              <button className="btn btn-secondary" onClick={() => { setChooseCourt(null); setChosen([]); }}>Cancel</button>
              <button className="btn btn-primary" disabled={chosen.length !== 4} onClick={confirmChoose}>
                {chosen.length === 4 ? 'Start match (4)' : `Pick ${4 - chosen.length} more`}
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Players overview sheet */}
      {playersOpen && (
        <>
          <div className="scrim is-open" onClick={() => setPlayersOpen(false)} />
          <aside className="sheet is-open" aria-hidden="false">
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>Players</h2>
                <p className="muted" style={{ fontSize: 12.5 }}>
                  {playersByGames.length} players · {playersByGames.reduce((a, r) => a + r.p.gamesPlayed, 0)} games played
                </p>
              </div>
              <button className="btn-icon" aria-label="Close" onClick={() => setPlayersOpen(false)}><XIcon /></button>
            </div>
            <div className="sheet-body">
              <div className="player-list">
                {playersByGames.map(({ p, pct }) => (
                  <div className="player-pick" key={p.id}>
                    <span className="pname">{p.name}</span>
                    <span className="pstars">{stars(p.skill ?? 3)}</span>
                    <span className="pgames"><strong style={{ color: 'var(--fg)', fontWeight: 800 }}>{p.gamesPlayed}</strong> g · {recordOf(p)} · {pct}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="sheet-foot">
              <button className="btn btn-secondary" onClick={() => setPlayersOpen(false)}>Close</button>
            </div>
          </aside>
        </>
      )}

      {/* Late check-in sheet */}
      {lateOpen && (
        <>
          <div className="scrim is-open" onClick={() => setLateOpen(false)} />
          <aside className="sheet is-open" aria-hidden="false">
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>Check in player</h2>
                <p className="muted" style={{ fontSize: 12.5 }}>Late arrivals jump to the front of the queue.</p>
              </div>
              <button className="btn-icon" aria-label="Close" onClick={() => setLateOpen(false)}><XIcon /></button>
            </div>
            <div className="sheet-body">
              <div className="card-title"><h3>New player</h3></div>
              <div className="field-row" style={{ marginTop: 8 }}>
                <input className="input" placeholder="Type a name..." value={lateName} autoFocus
                  onChange={(e) => setLateName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitLate(); }} />
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>Skill</span>
                <button className="stepper-btn" aria-label="Lower skill"
                  onClick={() => setLateSkill((v) => Math.max(1, v - 1))}>−</button>
                <span className="mono" style={{ minWidth: 20, textAlign: 'center', fontWeight: 800 }}>{lateSkill}</span>
                <button className="stepper-btn" aria-label="Raise skill"
                  onClick={() => setLateSkill((v) => Math.min(6, v + 1))}>+</button>
                <span className="muted" style={{ fontSize: 12 }}>{skillLabel(lateSkill)}</span>
              </div>
              <button className="btn btn-primary btn-big" style={{ marginTop: 14, width: '100%' }} onClick={commitLate}>
                Add to queue
              </button>
            </div>
            <div className="sheet-foot">
              <button className="btn btn-secondary" onClick={() => setLateOpen(false)}>Cancel</button>
            </div>
          </aside>
        </>
      )}
    </>
  );
  void recOf;
}

/* ---------------- Complete ---------------- */
function CompleteScreen({ session, setSession, go }: {
  session: Session; setSession: React.Dispatch<React.SetStateAction<Session>>; go: (r: Route) => void;
}) {
  const byId = useMemo(() => new Map(session.players.map((p) => [p.id, p])), [session.players]);
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';

  const games = session.matchLog.length;
  const minutes = session.startedAt ? Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 60000) : 0;
  const avgMatch = session.matchDurationsSec.length
    ? Math.round(session.matchDurationsSec.reduce((a, b) => a + b, 0) / session.matchDurationsSec.length)
    : 0;

  // Sequential competition ranks: ties share a rank, next increments by exactly 1.
  const ranked = useMemo(() => {
    const rows = rankStandings(session.players)
      .map((p) => ({ p, pct: p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0 }));
    let prevKey: string | null = null;
    let prevRank = 0;
    let seq = 0;
    return rows.map((r) => {
      const key = `${r.p.wins}-${r.p.losses}`;
      if (key !== prevKey) { seq += 1; prevKey = key; prevRank = seq; }
      return { ...r, rank: prevRank };
    });
  }, [session.players]);

  const participation = useMemo(() =>
    [...session.players].sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name)),
  [session.players]);

  const fresh = (samePlayers: boolean) => {
    const keep = samePlayers ? session.players.map((p) => ({
      ...newPlayer(p.name, p.skill),
    })) : [];
    setSession({
      ...emptySession(), name: session.name, courts: session.courts,
      matchingMode: session.matchingMode, showLiveStandings: session.showLiveStandings,
      players: keep,
    });
    go(samePlayers ? 'roster' : 'setup');
  };

  return (
    <main className="content">
      <section className="complete-band">
        <p className="eyebrow">SESSION OVER</p>
        <h1>Session complete</h1>
        <p className="stats-line">{games} games · {minutes} minutes · {session.courtStates.length} courts</p>
      </section>

      <p className="pace-line">avg match {fmtClock(avgMatch)} over {session.matchDurationsSec.length} timed matches</p>

      <section className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2>Final standings</h2>
        </div>
        <table className="std-table">
          <thead><tr><th>#</th><th>Name</th><th className="num-col">W-L</th><th className="num-col">G</th><th className="pct-col">W%</th></tr></thead>
          <tbody>
            {ranked.map(({ p, pct, rank }) => (
              <tr key={p.id}>
                <td className="rank">{medalSVG(rank)}</td>
                <td><strong>{p.name}</strong></td>
                <td className="num-col">{p.wins}-{p.losses}</td>
                <td className="num-col">{p.gamesPlayed}</td>
                <td className="pct-col" style={{ color: pct >= 50 ? 'var(--accent)' : 'var(--muted)' }}>{pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2>Participation</h2>
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{session.players.length} players</span>
        </div>
        <div>
          {participation.map((p) => {
            const pct = p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0;
            const avg = p.gamesPlayed > 1 && p.firstPlayedAt != null && p.lastPlayedAt != null
              ? fmtClock(Math.round((p.lastPlayedAt - p.firstPlayedAt) / 1000 / p.gamesPlayed))
              : '—';
            const first = p.firstPlayedAt != null
              ? fmtClock(Math.round(((session.startedAt ?? p.firstPlayedAt) ? (p.firstPlayedAt - (session.startedAt ?? p.firstPlayedAt)) / 1000 : 0)))
              : '—';
            const last = p.lastPlayedAt != null && session.startedAt != null
              ? fmtClock(Math.round((p.lastPlayedAt - session.startedAt) / 1000))
              : '—';
            return (
              <div className="player-row" key={p.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pname">{p.name}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {p.wins}-{p.losses} · {p.gamesPlayed} games · avg {avg}
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>
                  <div>{pct}%</div>
                  <div style={{ fontSize: 11 }}>{first}→{last}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2>Match log</h2>
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{games} finished</span>
        </div>
        <div>
          {[...session.matchLog].reverse().map((l) => (
            <div key={l.id} className="log-row-app">
              <span className="lnum">#{session.matchLog.findIndex((x) => x.id === l.id) + 1}</span>
              <span className="lct">CT{l.court}</span>
              <div className="lmatch">
                <strong>WIN</strong> {l.winners.map(nameOf).join(' + ')}<br />
                <span><strong>LOSE</strong> {l.losers.map(nameOf).join(' + ')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span className="ltime">{l.durationSec != null ? fmtMMSS(l.durationSec) : ''}</span>
                <span className="ltime" style={{ opacity: 0.6 }}>
                  {session.startedAt != null ? fmtMMSS(Math.max(0, Math.round((l.at - session.startedAt) / 1000))) : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <nav className="footer-bar">
        <button className="btn btn-secondary" onClick={() => fresh(true)}>Same players</button>
        <button className="btn btn-primary btn-big" onClick={() => fresh(false)}>Start new session</button>
      </nav>
    </main>
  );
}
/* ---------------- Tracking page (token-gated) ---------------- */
interface PlayRecord { id: number; ts: number; names: string[] }

function tokenFromUrl(): string | null {
  const segs = window.location.pathname.split('/').filter(Boolean);
  if (segs.length >= 2 && segs[0].toLowerCase() === 'tracking') return decodeURIComponent(segs[1]);
  const q = new URLSearchParams(window.location.search).get('token');
  return q;
}

function TrackingScreen() {
  const token = tokenFromUrl();
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const [plays, setPlays] = useState<PlayRecord[]>([]);

  useEffect(() => {
    if (!token) { setState('notfound'); return; }
    const url = `/api/plays?token=${encodeURIComponent(token)}`;
    fetch(url, { headers: { 'X-Tracking-Token': token } })
      .then(async (res) => {
        if (res.status === 404 || res.status === 401 || res.status === 403) { setState('notfound'); return; }
        if (!res.ok) { setState('error'); return; }
        const data = await res.json();
        setPlays(Array.isArray(data) ? data : (data.plays ?? []));
        setState('ok');
      })
      .catch(() => setState('error'));
  }, [token]);

  if (state === 'loading') {
    return <main className="app"><section className="card"><p className="muted">Loading…</p></section></main>;
  }
  if (state === 'notfound') {
    return <NotFoundScreen />;
  }
  if (state === 'error') {
    return <main className="app"><section className="card"><p className="muted">Tracker offline.</p></section></main>;
  }
  return (
    <main className="app">
      <section className="card">
        <h2>Played on court</h2>
        {plays.length === 0 ? (
          <p className="muted">No plays recorded yet.</p>
        ) : (
          <ul className="log-list">
            {plays.map((p) => (
              <li key={p.id} className="log-row-app">
                <span className="ltime">{new Date(p.ts).toLocaleString()}</span>
                <span>{(p.names || []).join(' + ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function NotFoundScreen() {
  return (
    <main className="app">
      <section className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 48, margin: 0 }}>404</h1>
        <p className="muted">Not found.</p>
      </section>
    </main>
  );
}
