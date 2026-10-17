import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNetworkFailure,
  isServerReachable,
  reportServerReachable,
  reportServerUnreachable,
  resetServerReachability,
  subscribeServerReachability,
} from '@/lib/serverReachability';

afterEach(() => {
  resetServerReachability();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('isNetworkFailure', () => {
  it('treats TypeError (Failed to fetch) as unreachable', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats browser network error messages as unreachable', () => {
    expect(isNetworkFailure(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isNetworkFailure(new Error('Load failed'))).toBe(true);
  });

  it('does not treat HTTP API errors as unreachable', () => {
    expect(isNetworkFailure(new Error('Request failed: 500'))).toBe(false);
    expect(isNetworkFailure(new Error('Unauthorized'))).toBe(false);
  });

  it('does not treat aborted fetches as unreachable', () => {
    const abort = new Error('The user aborted a request.');
    abort.name = 'AbortError';
    expect(isNetworkFailure(abort)).toBe(false);
  });
});

describe('server reachability flag', () => {
  it('starts reachable and notifies on transition', () => {
    const seen: boolean[] = [];
    subscribeServerReachability((v) => seen.push(v));

    expect(isServerReachable()).toBe(true);
    reportServerUnreachable();
    expect(isServerReachable()).toBe(false);
    reportServerReachable();
    expect(isServerReachable()).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('does not re-notify when the value is unchanged', () => {
    const seen: boolean[] = [];
    subscribeServerReachability((v) => seen.push(v));
    reportServerReachable();
    reportServerReachable();
    expect(seen).toEqual([]);
  });
});
