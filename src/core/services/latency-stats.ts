import { percentile } from '../../utils/utils';

/**
 * A single retained latency reading: `t` is the local receive time (used for age-based eviction),
 * `v` is the clock-corrected generation-to-receive latency in ms.
 */
export interface LatencySample {
  t: number;
  v: number;
}

/**
 * Mutable rolling window of recent latency samples for one exchange, plus the last exchange
 * generation timestamp accepted (for the strictly-advancing stale guard).
 */
export interface LatencyWindow {
  samples: LatencySample[];
  lastExchangeTs?: number;
}

/**
 * Aggregated latency statistics derived from a window.
 * - `p50`: median corrected latency (headline).
 * - `jitter`: p95 − p50 — how far the slow tail runs above the median.
 * - `samples`: number of readings in the window.
 * - `offsetMs`: clock offset applied when correcting these samples.
 * - `confidenceMs`: ± uncertainty on the absolute value (clock-sync path asymmetry).
 */
export interface LatencyStat {
  p50: number;
  jitter: number;
  samples: number;
  offsetMs: number;
  confidenceMs: number;
}

/** Creates an empty window. */
export function createLatencyWindow(): LatencyWindow {
  return { samples: [] };
}

/**
 * Attempts to record a new latency sample into the window and returns the updated {@link LatencyStat},
 * or `null` when the sample is rejected by the stale guard.
 *
 * Rejection rule (stale guard): the exchange generation timestamp must strictly advance vs. the
 * last accepted sample. During a resync storm the book emit can re-fire a latched, stale
 * (exchangeTs, receiveTs) pair; requiring `exchangeTs` to move forward drops those duplicates so
 * only fresh live-stream readings are counted.
 *
 * On acceptance: the corrected latency `max(0, receiveTs + offsetMs − exchangeTs)` is pushed,
 * entries older than `windowMs` are evicted, the window is capped at `maxSamples`, and p50/jitter
 * are recomputed. Clamping at 0 absorbs residual clock skew.
 *
 * @param win - The window to mutate.
 * @param input - Raw inputs for this sample.
 * @param input.exchangeTs - Venue's reported book-generation timestamp (epoch ms).
 * @param input.receiveTs - Local time the WS frame was received (epoch ms).
 * @param input.offsetMs - Clock offset (serverClock − localClock) to correct with.
 * @param input.confidenceMs - ± confidence bound to surface on the stat.
 * @param input.now - Current local time, used for the sample's age and eviction cutoff.
 * @param cfg - Window sizing.
 * @param cfg.windowMs - Max sample age retained.
 * @param cfg.maxSamples - Hard cap on retained samples.
 * @returns The updated stat, or `null` if the sample was rejected as stale/duplicate.
 */
export function recordLatencySample(
  win: LatencyWindow,
  input: {
    exchangeTs: number;
    receiveTs: number;
    offsetMs: number;
    confidenceMs: number;
    now: number;
  },
  cfg: { windowMs: number; maxSamples: number }
): LatencyStat | null {
  const { exchangeTs, receiveTs, offsetMs, confidenceMs, now } = input;

  // Stale guard: only strictly-newer generation timestamps are sampled.
  if (win.lastExchangeTs !== undefined && exchangeTs <= win.lastExchangeTs) return null;
  win.lastExchangeTs = exchangeTs;

  const corrected = Math.max(0, receiveTs + offsetMs - exchangeTs);

  win.samples.push({ t: now, v: corrected });

  const cutoff = now - cfg.windowMs;
  while (win.samples.length > 0 && win.samples[0].t < cutoff) win.samples.shift();
  if (win.samples.length > cfg.maxSamples) {
    win.samples.splice(0, win.samples.length - cfg.maxSamples);
  }

  const vals = win.samples.map((s) => s.v);
  const p50 = percentile(vals, 0.5);
  const p95 = percentile(vals, 0.95);

  return {
    p50,
    jitter: Math.max(0, p95 - p50),
    samples: vals.length,
    offsetMs,
    confidenceMs,
  };
}
