// Silent tracking beacon: records who played on a court.
// Fire-and-forget; never throws and never disrupts the queuing flow.
// The endpoint may not exist (offline/dev) - failures are swallowed.

const ENDPOINT = '/api/play';

export function trackPlay(names: string[]): void {
  try {
    if (!Array.isArray(names) || names.length === 0) return;
    const payload = { names: names.slice(0, 32).map((n) => String(n).slice(0, 60)), ts: Date.now() };
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: 'application/json' });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      } catch { /* fall through */ }
    }

    fetch(ENDPOINT, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => { /* swallow */ });
  } catch { /* swallow */ }
}