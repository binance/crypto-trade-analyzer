import { describe, it, expect } from 'vitest';
import { createLatencyWindow, recordLatencySample, type LatencyWindow } from '../latency-stats';

const CFG = { windowMs: 20000, maxSamples: 64 };

/** Records a sample with sensible defaults; returns the stat (or null if rejected). */
function rec(
  win: LatencyWindow,
  o: {
    exchangeTs: number;
    receiveTs: number;
    now: number;
    offsetMs?: number;
    confidenceMs?: number;
  }
) {
  return recordLatencySample(
    win,
    {
      exchangeTs: o.exchangeTs,
      receiveTs: o.receiveTs,
      offsetMs: o.offsetMs ?? 0,
      confidenceMs: o.confidenceMs ?? 0,
      now: o.now,
    },
    CFG
  );
}

describe('recordLatencySample — correction math', () => {
  it('corrected latency = max(0, receiveTs + offset − exchangeTs)', () => {
    const win = createLatencyWindow();
    const s = rec(win, { exchangeTs: 1000, receiveTs: 1100, now: 1100 });

    expect(s?.p50).toBe(100);
    expect(s?.samples).toBe(1);
  });

  it('applies a positive clock offset (local clock slow)', () => {
    const win = createLatencyWindow();
    const s = rec(win, { exchangeTs: 1250, receiveTs: 1100, now: 1100, offsetMs: 200 });

    expect(s?.p50).toBe(50);
  });

  it('clamps negative corrected latency to 0', () => {
    const win = createLatencyWindow();
    const s = rec(win, { exchangeTs: 2000, receiveTs: 1000, now: 1000, offsetMs: 0 });

    expect(s?.p50).toBe(0);
  });

  it('passes offsetMs and confidenceMs through to the stat', () => {
    const win = createLatencyWindow();
    const s = rec(win, {
      exchangeTs: 1000,
      receiveTs: 1100,
      now: 1100,
      offsetMs: 250,
      confidenceMs: 42,
    });

    expect(s?.offsetMs).toBe(250);
    expect(s?.confidenceMs).toBe(42);
  });
});

describe('recordLatencySample — stale guard', () => {
  it('rejects a sample whose exchangeTs does not strictly advance', () => {
    const win = createLatencyWindow();

    expect(rec(win, { exchangeTs: 1000, receiveTs: 1100, now: 1100 })).not.toBeNull();
    expect(rec(win, { exchangeTs: 1000, receiveTs: 1900, now: 1900 })).toBeNull();
    expect(rec(win, { exchangeTs: 900, receiveTs: 2000, now: 2000 })).toBeNull();
    expect(rec(win, { exchangeTs: 1001, receiveTs: 1101, now: 1200 })).not.toBeNull();
  });

  it('does not add rejected samples to the window', () => {
    const win = createLatencyWindow();

    rec(win, { exchangeTs: 1000, receiveTs: 1100, now: 1100 });
    rec(win, { exchangeTs: 1000, receiveTs: 5000, now: 5000 });

    expect(win.samples.length).toBe(1);
  });
});

describe('recordLatencySample — windowing', () => {
  it('evicts samples older than windowMs', () => {
    const win = createLatencyWindow();

    rec(win, { exchangeTs: 1, receiveTs: 101, now: 0 });
    rec(win, { exchangeTs: 2, receiveTs: 102, now: 10000 });

    const s = rec(win, { exchangeTs: 3, receiveTs: 103, now: 25000 });

    expect(win.samples.every((x) => x.t >= 5000)).toBe(true);
    expect(s?.samples).toBe(2);
  });

  it('caps the window at maxSamples', () => {
    const win = createLatencyWindow();
    const cfg = { windowMs: 10_000_000, maxSamples: 5 };
    for (let i = 0; i < 20; i++) {
      recordLatencySample(
        win,
        { exchangeTs: i + 1, receiveTs: i + 51, offsetMs: 0, confidenceMs: 0, now: i },
        cfg
      );
    }
    expect(win.samples.length).toBe(5);
  });
});

describe('recordLatencySample — p50 / jitter', () => {
  it('computes median and jitter (p95 − p50) over the window', () => {
    const win = createLatencyWindow();
    let stat = null as ReturnType<typeof rec>;

    for (let i = 0; i < 11; i++) {
      const latency = (i + 1) * 10;
      const exchangeTs = 1000 + i;
      stat = rec(win, { exchangeTs, receiveTs: exchangeTs + latency, now: 2000 + i });
    }

    expect(stat?.samples).toBe(11);
    expect(stat?.p50).toBe(60);
    expect(stat?.jitter).toBeCloseTo(45, 6);
  });

  it('reports zero jitter for a perfectly steady feed', () => {
    const win = createLatencyWindow();
    let stat = null as ReturnType<typeof rec>;
    for (let i = 0; i < 6; i++) {
      const exchangeTs = 1000 + i;
      stat = rec(win, { exchangeTs, receiveTs: exchangeTs + 100, now: 2000 + i });
    }
    expect(stat?.p50).toBe(100);
    expect(stat?.jitter).toBe(0);
  });
});
