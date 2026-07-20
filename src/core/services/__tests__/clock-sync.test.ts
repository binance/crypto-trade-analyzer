import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClockSyncService, type ClockSyncExchange } from '../clock-sync';

/**
 * Deterministic clock + fetch harness.
 *
 * `now` is a mutable virtual clock read by a Date.now spy. Each probe reads Date.now twice
 * (t0 before the request, t3 after); our fetch mock advances `now` by the probe's RTT in between,
 * and returns a server time constructed so the *measured* offset equals a chosen value:
 *   offset = serverTime − (t0 + t3)/2 = serverTime − (t0 + rtt/2).
 * Setting serverTime = t0 + rtt/2 + wantOffset makes the measured offset exactly `wantOffset`.
 */
function installHarness(opts: {
  venue: ClockSyncExchange;
  probes: { rtt: number; offset: number }[];
  fail?: boolean;
}) {
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  let i = 0;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (opts.fail) return new Response('nope', { status: 500 });

    const spec = opts.probes[Math.min(i, opts.probes.length - 1)];
    i++;
    const t0 = now;
    const serverTime = t0 + spec.rtt / 2 + spec.offset;
    now = t0 + spec.rtt;

    const body =
      opts.venue === 'Binance'
        ? { serverTime }
        : opts.venue === 'Bybit'
          ? { time: serverTime }
          : { data: [{ ts: String(serverTime) }] };
    return new Response(JSON.stringify(body), { status: 200 });
  });

  return { fetchSpy, setNow: (v: number) => (now = v) };
}

let svc: ClockSyncService;

beforeEach(() => {
  svc = new ClockSyncService();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClockSyncService — offset math', () => {
  it('computes offset = serverTime − midpoint and confidence = rtt/2', async () => {
    const { fetchSpy } = installHarness({
      venue: 'Binance',
      probes: Array.from({ length: 5 }, () => ({ rtt: 100, offset: 500 })),
    });

    svc.ensureFresh('Binance');
    await vi.waitFor(() => expect(svc.getSyncInfo('Binance').synced).toBe(true));

    const info = svc.getSyncInfo('Binance');
    expect(info.offsetMs).toBeCloseTo(500, 6);
    expect(info.rttMs).toBe(100);
    expect(info.confidenceMs).toBe(50);
    expect(svc.getOffset('Binance')).toBeCloseTo(500, 6);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('handles a negative offset (server behind local)', async () => {
    installHarness({
      venue: 'OKX',
      probes: Array.from({ length: 5 }, () => ({ rtt: 80, offset: -250 })),
    });

    svc.ensureFresh('OKX');
    await vi.waitFor(() => expect(svc.getSyncInfo('OKX').synced).toBe(true));

    expect(svc.getOffset('OKX')).toBeCloseTo(-250, 6);
    expect(svc.getSyncInfo('OKX').confidenceMs).toBe(40);
  });
});

describe('ClockSyncService — best-of-N selection', () => {
  it('keeps the probe with the smallest RTT', async () => {
    installHarness({
      venue: 'Bybit',
      probes: [
        { rtt: 300, offset: 100 },
        { rtt: 300, offset: 100 },
        { rtt: 40, offset: 777 },
        { rtt: 300, offset: 100 },
        { rtt: 300, offset: 100 },
      ],
    });

    svc.ensureFresh('Bybit');
    await vi.waitFor(() => expect(svc.getSyncInfo('Bybit').synced).toBe(true));

    const info = svc.getSyncInfo('Bybit');
    expect(info.rttMs).toBe(40);
    expect(info.offsetMs).toBeCloseTo(777, 6);
    expect(info.confidenceMs).toBe(20);
  });
});

describe('ClockSyncService — bad probes', () => {
  it('rejects probes whose RTT exceeds the cap → stays unsynced', async () => {
    installHarness({
      venue: 'Binance',
      probes: Array.from({ length: 5 }, () => ({ rtt: 5000, offset: 500 })),
    });

    svc.ensureFresh('Binance');

    await vi.waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(5)
    );
    await Promise.resolve();

    const info = svc.getSyncInfo('Binance');
    expect(info.synced).toBe(false);
    expect(info.offsetMs).toBe(0);
    expect(svc.getOffset('Binance')).toBe(0);
  });

  it('stays unsynced when the endpoint errors', async () => {
    installHarness({ venue: 'OKX', probes: [{ rtt: 50, offset: 100 }], fail: true });

    svc.ensureFresh('OKX');
    await vi.waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
    );
    await Promise.resolve();

    expect(svc.getSyncInfo('OKX').synced).toBe(false);
    expect(svc.getOffset('OKX')).toBe(0);
  });

  it('backs off after a failed round — does not re-probe immediately', async () => {
    const { fetchSpy, setNow } = installHarness({
      venue: 'Binance',
      probes: [{ rtt: 50, offset: 100 }],
      fail: true,
    });

    svc.ensureFresh('Binance');
    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBe(5));
    await Promise.resolve();

    svc.ensureFresh('Binance');
    await Promise.resolve();
    expect(fetchSpy.mock.calls.length).toBe(5);

    setNow(1_000_000 + 20_000);
    svc.ensureFresh('Binance');
    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBe(10));
  });
});

describe('ClockSyncService — caching / ensureFresh', () => {
  it('does not re-probe while the cached offset is fresh', async () => {
    const { fetchSpy } = installHarness({
      venue: 'Binance',
      probes: Array.from({ length: 5 }, () => ({ rtt: 100, offset: 500 })),
    });

    svc.ensureFresh('Binance');
    await vi.waitFor(() => expect(svc.getSyncInfo('Binance').synced).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    svc.ensureFresh('Binance');
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('probes each exchange independently', async () => {
    installHarness({
      venue: 'Bybit',
      probes: Array.from({ length: 5 }, () => ({ rtt: 60, offset: 42 })),
    });

    svc.ensureFresh('Bybit');
    await vi.waitFor(() => expect(svc.getSyncInfo('Bybit').synced).toBe(true));

    expect(svc.getSyncInfo('OKX').synced).toBe(false);
    expect(svc.getOffset('OKX')).toBe(0);
  });
});

describe('ClockSyncService — per-venue response parsing', () => {
  it('parses Bybit timeNano fallback when top-level time is absent', async () => {
    let now = 500_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const t0 = now;
      const serverMs = t0 + 50;
      now = t0 + 100;

      return new Response(JSON.stringify({ result: { timeNano: String(serverMs * 1e6) } }), {
        status: 200,
      });
    });

    svc.ensureFresh('Bybit');
    await vi.waitFor(() => expect(svc.getSyncInfo('Bybit').synced).toBe(true));

    expect(svc.getOffset('Bybit')).toBeCloseTo(0, 3);
  });
});
