import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CourtState, LoggedMatch, MatchingMode, MODES, Player, Session, UpNextMatch, uid,
} from './types';
import { applyResult, buildUpNext, fairPool, rankStandings, spread } from './scheduler';
import { loadSession, saveSession } from './storage';

type Route = 'choose' | 'setup' | 'roster' | 'play' | 'complete';
type Toast = { msg: string; undo?: () => void } | null;

const SKILL_LABEL = ['—', 'Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert', 'Elite'];

function emptySession(): Session {
  return {
    id: uid(), name: 'Open Play', courts: 2, format: 'doubles',
    gameLimit: null, showLiveStandings: true, matchingMode: 'balanced',
    players: [], courtStates: [], upNext: [], matchLog: [],
    startedAt: null, endedAt: null, matchDurationsSec: [],
  };
}

function newPlayer(name: string): Player {
  const now = Date.now();
  return {
    id: uid(), name, skill: null, gender: null, checkedIn: false,
    gamesPlayed: 0, wins: 0, losses: 0, waitStartedAt: now,
    checkedInAt: null, presentMinutes: 0, lockedPartnerId: null,
    recentPartners: [], recentOpponents: [],
  };
}

function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function useNow(stepMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

export default function App() {
  const [route, setRoute] = useState<Route>('choose');
  const [session, setSession] = useState<Session>(() => loadSession() ?? emptySession());
  const [showHiddenModes, setShowHiddenModes] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => { saveSession(session); }, [session]);
  // Resume: if a live session was persisted, jump to play.
  useEffect(() => {
    const s = loadSession();
    if (s && s.startedAt && !s.endedAt && s.courtStates.length > 0) setRoute('play');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  };

  const update = (fn: (s: Session) => Session) => setSession((s) => fn({ ...s }));

  const startPlay = () => {
    const courts: CourtState[] = Array.from({ length: session.courts }, (_, i) => ({
      id: i + 1, status: 'ready', teamA: [], teamB: [], startedAt: null,
    }));
    const staged = buildUpNext(session.players, new Set(), session.matchingMode, session.format, session.courts, session.gameLimit);
    const upNext: UpNextMatch[] = staged.map((m) => ({ id: uid(), auto: true, ...m }));
    setSession({ ...session, courtStates: courts, upNext, matchLog: [], startedAt: Date.now(), endedAt: null, matchDurationsSec: [] });
    setRoute('play');
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">PickleQueue</span>
        {route === 'play' && (
          <span className="hud">
            {MODES.find((m) => m.id === session.matchingMode)?.label} · 🏆{' '}
            <button className="linkbtn" onClick={() => setConfirmEnd(true)}>End</button> ·{' '}
            {session.name} · COURTS {session.courtStates.filter((c) => c.status === 'live').length}/{session.courtStates.length} ·{' '}
            PLAYERS {session.players.filter((p) => p.checkedIn).length} · QUEUE {queueCount(session)}
          </span>
        )}
      </header>

      {route === 'choose' && <ChooseScreen go={setRoute} />}
      {route === 'setup' && (
        <SetupScreen session={session} update={update} go={setRoute} showHidden={showHiddenModes} setShowHidden={setShowHiddenModes} />
      )}
      {route === 'roster' && (
        <RosterScreen session={session} update={update} go={setRoute} flash={flash} onStart={startPlay} />
      )}
      {route === 'play' && (
        <PlayScreen session={session} setSession={setSession} flash={flash} go={setRoute} />
      )}
      {route === 'complete' && (
        <CompleteScreen session={session} setSession={setSession} go={setRoute} />
      )}

      {toast && (
        <div className="toast">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}
          <button onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {confirmEnd && (
        <div className="modal-back">
          <div className="modal">
            <h3>End Session?</h3>
            <p>This will finalize the leaderboard. This can't be undone.</p>
            <div className="row">
              <button onClick={() => setConfirmEnd(false)}>Cancel</button>
              <button className="primary" onClick={() => {
                setConfirmEnd(false);
                setSession((s) => ({ ...s, endedAt: Date.now() }));
                setRoute('complete');
              }}>End Session</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function queueCount(s: Session) {
  const seated = new Set(s.courtStates.flatMap((c) => [...c.teamA, ...c.teamB]));
  const staged = new Set(s.upNext.flatMap((m) => [...m.teamA, ...m.teamB]));
  return s.players.filter((p) => p.checkedIn && !seated.has(p.id) && !staged.has(p.id)).length;
}

/* ---------------- Choose ---------------- */
function ChooseScreen({ go }: { go: (r: Route) => void }) {
  return (
    <div className="choose">
      <h1>Set up open play in 60 seconds</h1>
      <p className="muted">No signup required · Works offline</p>
      <div className="cards">
        <button className="bigcard" onClick={() => go('setup')}>
          <b>I organize open play</b>
          <span>Full setup: courts, modes, live queue</span>
        </button>
        <button className="bigcard" onClick={() => go('setup')}>
          <b>Just playing with friends</b>
          <span>Quick start — same setup, no fuss</span>
        </button>
      </div>
      <p><a href="#" onClick={(e) => e.preventDefault()}>Already have a club? Log in</a></p>
      <p><a href="#" onClick={(e) => e.preventDefault()}>Read the 60-second guide</a></p>
    </div>
  );
}

/* ---------------- Setup wizard ---------------- */
function SetupScreen({ session, update, go, showHidden, setShowHidden }: {
  session: Session; update: (fn: (s: Session) => Session) => void; go: (r: Route) => void;
  showHidden: boolean; setShowHidden: (v: boolean) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(session.name);
  const visibleModes = MODES.filter((m) => !m.hidden || showHidden);

  return (
    <div className="setup">
      <div className="steps">1 Set up session · 2 Add players · 3 Start</div>
      <h2>Set up session</h2>

      <section>
        <h3>Courts (1–64)</h3>
        <div className="row">
          <button onClick={() => update((s) => ({ ...s, courts: Math.max(1, s.courts - 1) }))}>−</button>
          <b>{session.courts}</b>
          <button onClick={() => update((s) => ({ ...s, courts: Math.min(64, s.courts + 1) }))}>+</button>
        </div>
      </section>

      <section>
        <h3>Session name</h3>
        {editingName ? (
          <div className="row">
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
            <button className="primary" onClick={() => {
              update((s) => ({ ...s, name: nameDraft.trim() || s.name }));
              setEditingName(false);
            }}>Rename</button>
          </div>
        ) : (
          <div className="row"><b>{session.name}</b><button onClick={() => { setNameDraft(session.name); setEditingName(true); }}>Rename</button></div>
        )}
      </section>

      <section>
        <h3>Format</h3>
        <div className="row">
          {(['doubles', 'singles'] as const).map((f) => (
            <button key={f} className={session.format === f ? 'sel' : ''} onClick={() => update((s) => ({ ...s, format: f }))}>
              {f === 'doubles' ? 'Doubles' : 'Singles'}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Game limit <span className="muted">(everyone plays same number of games — empty = unlimited)</span></h3>
        <input type="number" min={1} placeholder="No limit"
          value={session.gameLimit ?? ''}
          onChange={(e) => update((s) => ({ ...s, gameLimit: e.target.value ? Math.max(1, parseInt(e.target.value, 10)) : null }))} />
      </section>

      <section>
        <div className="row">
          <label><input type="checkbox" checked={session.showLiveStandings}
            onChange={(e) => update((s) => ({ ...s, showLiveStandings: e.target.checked }))} /> Live standings</label>
        </div>
      </section>

      <section>
        <h3>Matching mode</h3>
        <div className="modegrid">
          {visibleModes.map((m) => (
            <button key={m.id} className={session.matchingMode === m.id ? 'modecard sel' : 'modecard'}
              onClick={() => update((s) => ({ ...s, matchingMode: m.id as MatchingMode }))}>
              <b>{m.label}</b><span>{m.desc}</span>
            </button>
          ))}
        </div>
        <button className="linkbtn" onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? 'Hide options ▲' : 'Show more options ▼ (Skill Courts · Mixed Doubles · King/Queen · Club Wars · Tournament)'}
        </button>
      </section>

      <div className="row">
        <button onClick={() => go('choose')}>← Back</button>
        <button className="primary" onClick={() => go('roster')}>Continue to players →</button>
      </div>
    </div>
  );
}

/* ---------------- Roster ---------------- */
function RosterScreen({ session, update, go, flash, onStart }: {
  session: Session; update: (fn: (s: Session) => Session) => void; go: (r: Route) => void;
  flash: (msg: string, undo?: () => void) => void; onStart: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [pairArm, setPairArm] = useState<string | null>(null);
  const [reclubOpen, setReclubOpen] = useState(false);
  const [reclubText, setReclubText] = useState('');

  const addName = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    update((s) => ({ ...s, players: [...s.players, newPlayer(name)] }));
    setDraft('');
  };

  const checkedIn = session.players.filter((p) => p.checkedIn).length;
  const need = session.format === 'singles' ? 2 : 4;
  const ready = checkedIn >= need;

  const checkIn = (id: string, v: boolean) => update((s) => ({
    ...s,
    players: s.players.map((p) => p.id === id
      ? { ...p, checkedIn: v, checkedInAt: v ? Date.now() : p.checkedInAt, waitStartedAt: v ? Date.now() : p.waitStartedAt }
      : p),
  }));

  const pairWith = (id: string) => {
    if (!pairArm) { setPairArm(id); return; }
    if (pairArm === id) { setPairArm(null); return; }
    const a = pairArm;
    setPairArm(null);
    update((s) => ({
      ...s,
      players: s.players.map((p) => p.id === a ? { ...p, lockedPartnerId: id } : p.id === id ? { ...p, lockedPartnerId: a } : p),
    }));
    flash('Pair locked');
  };

  const importReclub = () => {
    const names = reclubText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (names.length === 0) return;
    update((s) => ({ ...s, players: [...s.players, ...names.map((n) => newPlayer(n))] }));
    setReclubText('');
    setReclubOpen(false);
    flash(`Imported ${names.length} players`);
  };

  return (
    <div className="roster">
      <div className="steps">1 Set up session · 2 Add players ({checkedIn}/{need} ready) · 3 Start</div>
      <h2>Add players</h2>

      <div className="row">
        <input placeholder="Search or add player..." value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addName(draft); }} />
        <button className="primary" onClick={() => addName(draft)}>Add</button>
      </div>

      <div className="row">
        <button onClick={() => update((s) => ({ ...s, players: s.players.map((p) => ({ ...p, checkedIn: true, checkedInAt: p.checkedInAt ?? Date.now() })) }))}>
          Check in all
        </button>
        <button onClick={() => setReclubOpen(!reclubOpen)}>Import from Reclub</button>
      </div>

      {reclubOpen && (
        <div className="reclub">
          <p className="muted">Paste participant list (one name per line) → review → import.</p>
          <textarea rows={5} value={reclubText} onChange={(e) => setReclubText(e.target.value)} placeholder={'Alex\nSam\nJo'} />
          <div className="row"><button className="primary" onClick={importReclub}>Import</button></div>
        </div>
      )}

      <h3>Checked In ({checkedIn})</h3>
      {session.players.filter((p) => p.checkedIn).map((p) => (
        <PlayerRow key={p.id} p={p} players={session.players} pairArm={pairArm}
          onSkill={(v) => update((s) => ({ ...s, players: s.players.map((q) => q.id === p.id ? { ...q, skill: v } : q) }))}
          onCheck={() => checkIn(p.id, false)}
          onRemove={() => update((s) => ({ ...s, players: s.players.filter((q) => q.id !== p.id) }))}
          onPair={() => pairWith(p.id)}
          onUnpair={() => update((s) => ({ ...s, players: s.players.map((q) => q.lockedPartnerId === p.id ? { ...q, lockedPartnerId: null } : q.id === p.id ? { ...q, lockedPartnerId: null } : q) }))}
        />
      ))}

      <h3>Not Yet Here ({session.players.filter((p) => !p.checkedIn).length})</h3>
      {session.players.filter((p) => !p.checkedIn).map((p) => (
        <PlayerRow key={p.id} p={p} players={session.players} pairArm={pairArm}
          onSkill={(v) => update((s) => ({ ...s, players: s.players.map((q) => q.id === p.id ? { ...q, skill: v } : q) }))}
          onCheck={() => checkIn(p.id, true)}
          onRemove={() => update((s) => ({ ...s, players: s.players.filter((q) => q.id !== p.id) }))}
          onPair={() => pairWith(p.id)}
          onUnpair={() => { /* not checked in */ }}
        />
      ))}

      <div className="stickybar">
        <button onClick={() => go('setup')}>← Back</button>
        <button className="primary big" disabled={!ready} onClick={onStart} title={ready ? '' : `Need ${need} checked in`}>
          START PLAY {ready ? `(${checkedIn} ready)` : `(${checkedIn}/${need} ready)`}
        </button>
      </div>
    </div>
  );
}

function PlayerRow({ p, players, pairArm, onSkill, onCheck, onRemove, onPair, onUnpair }: {
  p: Player; players: Player[]; pairArm: string | null;
  onSkill: (v: number | null) => void; onCheck: () => void; onRemove: () => void;
  onPair: () => void; onUnpair: () => void;
}) {
  const mate = p.lockedPartnerId ? players.find((q) => q.id === p.lockedPartnerId) : null;
  return (
    <div className="playerrow">
      <b>{p.name}</b>
      <span className="stars" title={p.skill ? SKILL_LABEL[p.skill] : 'Unrated'}>
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <button key={s} className={p.skill != null && s <= p.skill ? 'star on' : 'star'} onClick={() => onSkill(p.skill === s ? null : s)}>★</button>
        ))}
      </span>
      <span className="muted">{p.skill ? SKILL_LABEL[p.skill] : ''}{mate ? ` · 🔗 ${mate.name}` : ''}</span>
      <span className="spacer" />
      {p.checkedIn ? (
        <>
          <button className={pairArm === p.id ? 'sel' : ''} onClick={onPair} title="Pair lock">Pair</button>
          {mate && <button onClick={onUnpair} title="Remove pair lock">Unpair</button>}
          <button onClick={onCheck} title="Check out">✕</button>
        </>
      ) : (
        <>
          <button onClick={onCheck}>Check in</button>
          <button onClick={onRemove} title="Remove">✕</button>
        </>
      )}
    </div>
  );
}

/* ---------------- Play ---------------- */
function PlayScreen({ session, setSession, flash, go }: {
  session: Session; setSession: React.Dispatch<React.SetStateAction<Session>>;
  flash: (msg: string, undo?: () => void) => void; go: (r: Route) => void;
}) {
  const now = useNow(1000);
  const [chooseCourt, setChooseCourt] = useState<number | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const byId = useMemo(() => new Map(session.players.map((p) => [p.id, p])), [session.players]);
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';
  const seated = useMemo(() => new Set(session.courtStates.flatMap((c) => [...c.teamA, ...c.teamB])), [session]);
  const staged = useMemo(() => new Set(session.upNext.flatMap((m) => [...m.teamA, ...m.teamB])), [session.upNext]);

  const avgMatchSec = session.matchDurationsSec.length
    ? Math.round(session.matchDurationsSec.reduce((a, b) => a + b, 0) / session.matchDurationsSec.length)
    : 600;

  const stageMore = (s: Session): Session => {
    const seatedIds = new Set(s.courtStates.flatMap((c) => [...c.teamA, ...c.teamB]));
    const stagedIds = new Set(s.upNext.flatMap((m) => [...m.teamA, ...m.teamB]));
    const readyCount = s.courtStates.filter((c) => c.status === 'ready').length;
    const target = Math.max(1, readyCount);
    // Game limit acts as a fairness cap: players at the cap sit out of auto-staging.
    const built = buildUpNext(s.players, new Set([...seatedIds, ...stagedIds]), s.matchingMode, s.format, target, s.gameLimit);
    if (built.length === 0) return s;
    return { ...s, upNext: [...s.upNext, ...built.map((m) => ({ id: uid(), auto: true, ...m }))] };
  };

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
      return stageMore(next);
    });
  };

  const recordWin = (court: CourtState, winner: 'A' | 'B') => {
    const winners = winner === 'A' ? court.teamA : court.teamB;
    const wnames = winners.map(nameOf).join(' & ');
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
      return stageMore(next);
    });
    flash(`Recorded result · ${wnames} won`, () => {
      setSession((prev) => ({
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

  const queue = fairPool(session.players).filter((p) => !seated.has(p.id) && !staged.has(p.id));

  const confirmChoose = () => {
    const need = session.format === 'singles' ? 2 : 4;
    if (chooseCourt == null || chosen.length !== need) return;
    const teamA = session.format === 'singles' ? [chosen[0]] : [chosen[0], chosen[1]];
    const teamB = session.format === 'singles' ? [chosen[1]] : [chosen[2], chosen[3]];
    const cid = chooseCourt;
    setSession((prev) => ({
      ...prev,
      courtStates: prev.courtStates.map((c) => c.id === cid
        ? { ...c, status: 'live' as const, teamA, teamB, startedAt: Date.now() } : c),
      upNext: prev.upNext.filter((m) => ![...teamA, ...teamB].some((id) => [...m.teamA, ...m.teamB].includes(id))),
    }));
    setChooseCourt(null);
    setChosen([]);
  };

  return (
    <div className="play">
      <section>
        <div className="row">
          <h2>LIVE COURTS</h2>
          <button onClick={() => setSession((prev) => prev.courtStates.length >= 64 ? prev : {
            ...prev, courts: prev.courts + 1,
            courtStates: [...prev.courtStates, { id: Math.max(0, ...prev.courtStates.map((c) => c.id)) + 1, status: 'ready' as const, teamA: [], teamB: [], startedAt: null }],
          })}>+ Add Court</button>
        </div>
        <div className="courts">
          {session.courtStates.map((c) => (
            <div key={c.id} className={c.status === 'live' ? 'court live' : 'court ready'}>
              <div className="row"><b>Court {c.id}</b>
                <span className={c.status === 'live' ? 'badge live' : 'badge ready'}>
                  {c.status === 'live' ? `LIVE ${c.startedAt ? fmtClock(Math.max(0, Math.round((now - c.startedAt) / 1000))) : ''}` : 'READY'}
                </span>
              </div>
              {c.status === 'live' ? (
                <>
                  <div className="teams">
                    <span>Team 1: {c.teamA.map(nameOf).join(' & ')}</span>
                    <span>vs</span>
                    <span>Team 2: {c.teamB.map(nameOf).join(' & ')}</span>
                  </div>
                  <div className="row">
                    <button className="primary" onClick={() => recordWin(c, 'A')}>Team 1 Wins</button>
                    <button className="primary" onClick={() => recordWin(c, 'B')}>Team 2 Wins</button>
                  </div>
                </>
              ) : (
                <button onClick={() => { setChooseCourt(c.id); setChosen([]); }}>Choose Players</button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Up Next (Auto)</h2>
        {session.upNext.length === 0 && <p className="muted">No matches staged — everyone is playing or queue is short.</p>}
        {session.upNext.map((m) => (
          <div key={m.id} className="upnext">
            <span>{m.teamA.map(nameOf).join(' & ')} vs {m.teamB.map(nameOf).join(' & ')}</span>
            <span className="muted">{m.auto ? 'Auto' : 'Manual'}</span>
            <button onClick={() => setSession((prev) => ({ ...prev, upNext: prev.upNext.filter((x) => x.id !== m.id) }))}>✕</button>
            {session.courtStates.filter((c) => c.status === 'ready').map((c) => (
              <button key={c.id} className="primary" onClick={() => sendToCourt(m.id, c.id)}>Send to Court {c.id}</button>
            ))}
          </div>
        ))}
      </section>

      <section>
        <h2>Queue ({queue.length})</h2>
        <div className="qtable">
          <div className="qhead"><span>#</span><span>Player</span><span>Skill</span><span>Games</span><span>W%</span><span>ETA</span><span></span></div>
          {queue.map((p, i) => (
            <div key={p.id} className="qrow">
              <span>{i + 1}</span><span>{p.name}</span><span>{p.skill ?? '—'}</span>
              <span>{p.gamesPlayed}</span>
              <span>{p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) + '%' : '—'}</span>
              <span>⏳ {fmtClock(Math.max(0, (i) * avgMatchSec))}</span>
              <span><button onClick={() => setSession((prev) => ({ ...prev, players: prev.players.map((q) => q.id === p.id ? { ...q, checkedIn: false } : q) }))}>✕</button></span>
            </div>
          ))}
        </div>
      </section>

      {session.showLiveStandings && (
        <section>
          <h2>Live Standings</h2>
          {rankStandings(session.players).slice(0, 10).map((p, i) => (
            <div key={p.id} className="qrow"><span>{i + 1}</span><span>{p.name}</span><span></span>
              <span>{p.gamesPlayed}</span><span>{Math.round((p.wins / p.gamesPlayed) * 100)}%</span><span></span><span></span></div>
          ))}
        </section>
      )}

      <section>
        <h2>Match Log ({session.matchLog.length})</h2>
        {[...session.matchLog].reverse().map((l, idx) => (
          <div key={l.id} className="qrow">
            <span>#{session.matchLog.length - idx}</span>
            <span>CT{l.court}</span>
            <span>WIN {l.winners.map(nameOf).join(' & ')}</span>
            <span>LOSE {l.losers.map(nameOf).join(' & ')}</span>
            <span>{new Date(l.at).toLocaleTimeString()}</span>
            <span><button onClick={() => swapWinner(l)}>Swap winner</button></span>
          </div>
        ))}
      </section>

      <div className="stickybar">
        <button onClick={() => go('roster')}>Players</button>
        <span className="muted">games spread: {spread(session.players)}</span>
      </div>

      {chooseCourt != null && (
        <div className="modal-back">
          <div className="modal wide">
            <h3>Choose players — Court {chooseCourt}</h3>
            <p className="muted">Pick {session.format === 'singles' ? 2 : 4} ({chosen.length} selected)</p>
            {fairPool(session.players).filter((p) => !seated.has(p.id)).map((p) => (
              <div key={p.id} className="playerrow">
                <label>
                  <input type="checkbox" checked={chosen.includes(p.id)}
                    onChange={() => setChosen((c) => c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id])} />
                  {p.name} <span className="muted">(g{p.gamesPlayed})</span>
                </label>
              </div>
            ))}
            <div className="row">
              <button onClick={() => { setChooseCourt(null); setChosen([]); }}>Cancel</button>
              <button className="primary" onClick={confirmChoose}>Start match</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Complete ---------------- */
function CompleteScreen({ session, setSession, go }: {
  session: Session; setSession: React.Dispatch<React.SetStateAction<Session>>; go: (r: Route) => void;
}) {
  const [showProv, setShowProv] = useState(false);
  const byId = useMemo(() => new Map(session.players.map((p) => [p.id, p])), [session.players]);
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';
  const ranked = rankStandings(session.players);
  const main = ranked.filter((p) => p.gamesPlayed >= 5);
  const prov = ranked.filter((p) => p.gamesPlayed < 5);

  const games = session.matchLog.length;
  const minutes = session.startedAt ? Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 60000) : 0;
  const avgMatch = session.matchDurationsSec.length
    ? Math.round(session.matchDurationsSec.reduce((a, b) => a + b, 0) / session.matchDurationsSec.length)
    : 0;

  const share = () => {
    const lines = main.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} ${p.wins}W-${p.losses}L`);
    const text = `${session.name} — ${games} games, ${minutes} min\n` + lines.join('\n');
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const fresh = (samePlayers: boolean) => {
    const keep = samePlayers ? session.players.map((p) => ({
      ...newPlayer(p.name), name: p.name, skill: p.skill, gender: p.gender,
    })) : [];
    setSession({ ...emptySession(), name: session.name, courts: session.courts, format: session.format, matchingMode: session.matchingMode, showLiveStandings: session.showLiveStandings, players: keep });
    go(samePlayers ? 'roster' : 'setup');
  };

  return (
    <div className="complete">
      <h1>Session Complete 🎉</h1>
      <p>{games} games · {minutes} minutes · {session.courtStates.length} courts</p>
      <p className="muted">Session pace: avg match {fmtClock(avgMatch)} (based on {session.matchDurationsSec.length} timed matches)</p>

      <h2>FINAL STANDINGS</h2>
      {main.map((p, i) => (
        <div key={p.id} className="qrow">
          <span>{i + 1}</span><span>{p.name}</span>
          <span>{p.wins}W-{p.losses}L</span>
          <span>{Math.round((p.wins / p.gamesPlayed) * 100)}%</span>
          <span>{p.gamesPlayed} games</span><span></span>
        </div>
      ))}

      <button className="linkbtn" onClick={() => setShowProv(!showProv)}>
        PROVISIONAL (&lt;5 games, {prov.length}) {showProv ? '▲' : '▼'}
      </button>
      {showProv && prov.map((p) => (
        <div key={p.id} className="qrow muted"><span>~</span><span>{p.name}</span>
          <span>{p.wins}W-{p.losses}L</span><span>{p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) + '%' : '—'}</span>
          <span>{p.gamesPlayed} games</span><span></span></div>
      ))}

      <h2>Participation</h2>
      {session.players.map((p) => (
        <div key={p.id} className="qrow"><span></span><span>{p.name}</span><span>{p.gamesPlayed} games</span>
          <span>{p.checkedIn ? 'present' : 'checked out'}</span><span></span><span></span></div>
      ))}

      <h2>Match Log</h2>
      {[...session.matchLog].reverse().map((l, idx) => (
        <div key={l.id} className="qrow"><span>#{session.matchLog.length - idx}</span>
          <span>CT{l.court}</span><span>{l.winners.map(nameOf).join(' & ')}</span>
          <span>{l.losers.map(nameOf).join(' & ')}</span><span></span><span></span></div>
      ))}

      <div className="row">
        <button onClick={share}>Share</button>
        <button className="primary" onClick={() => fresh(false)}>Start new session</button>
        <button className="primary" onClick={() => fresh(true)}>Start with same players</button>
      </div>
    </div>
  );
}
