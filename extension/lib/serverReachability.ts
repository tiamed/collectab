type Listener = (reachable: boolean) => void;

let reachable = true;
const listeners = new Set<Listener>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeDelayMs = 3000;
let getHealthUrl: () => string = () => '';

const PROBE_TIMEOUT_MS = 4000;
const PROBE_DELAY_MIN_MS = 3000;
const PROBE_DELAY_MAX_MS = 15000;

export function configureHealthUrl(fn: () => string) {
  getHealthUrl = fn;
}

export function isServerReachable(): boolean {
  return reachable;
}

export function subscribeServerReachability(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function isAbortError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  return err instanceof Error && err.name === 'AbortError';
}

export function isNetworkFailure(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    return (
      m.includes('failed to fetch') ||
      m.includes('networkerror') ||
      m.includes('load failed') ||
      m.includes('network request failed')
    );
  }
  return false;
}

function notify() {
  for (const cb of listeners) cb(reachable);
}

function stopProbe() {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  probeDelayMs = PROBE_DELAY_MIN_MS;
}

function setReachable(next: boolean) {
  if (reachable === next) return;
  reachable = next;
  if (next) stopProbe();
  else scheduleProbe(PROBE_DELAY_MIN_MS);
  notify();
}

export function reportServerReachable() {
  setReachable(true);
}

export function reportServerUnreachable() {
  setReachable(false);
}

async function probeOnce(): Promise<boolean> {
  const url = getHealthUrl();
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function scheduleProbe(delay: number) {
  if (probeTimer) return;
  probeDelayMs = delay;
  probeTimer = setTimeout(() => {
    probeTimer = null;
    void runProbe();
  }, delay);
}

async function runProbe() {
  if (reachable) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    scheduleProbe(Math.min(probeDelayMs * 2, PROBE_DELAY_MAX_MS));
    return;
  }
  const ok = await probeOnce();
  if (reachable) return;
  if (ok) {
    reportServerReachable();
    return;
  }
  scheduleProbe(Math.min(probeDelayMs * 2, PROBE_DELAY_MAX_MS));
}

/** Immediate health check — used when the browser comes back online or the tab is shown. */
export function probeServerNow() {
  if (reachable) return;
  stopProbe();
  void runProbe();
}

/** Test helper: restore optimistic reachable state and drop listeners/timers. */
export function resetServerReachability() {
  stopProbe();
  reachable = true;
  listeners.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => probeServerNow());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) probeServerNow();
  });
}
