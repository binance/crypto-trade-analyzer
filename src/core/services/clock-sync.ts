import { FUTURES_REST_API_URL as BINANCE_FUTURES_REST_API_URL } from '../../exchanges/binance/utils/constants';
import { REST_API_URL as BYBIT_REST_API_URL } from '../../exchanges/bybit/utils/constants';
import { REST_API_URL as OKX_REST_API_URL } from '../../exchanges/okx/utils/constants';

export type ClockSyncExchange = 'Binance' | 'Bybit' | 'OKX';

// How long an offset estimate is trusted before a background refresh is triggered.
const OFFSET_TTL_MS = 60 * 1000;

// Backoff after a fully failed sync (no usable probe): wait this long before retrying, so a down
// or slow time endpoint can't be hammered ~once per book update. Shorter than the success TTL
// because we still want to recover reasonably quickly once the endpoint is healthy again.
const FAILURE_BACKOFF_MS = 15 * 1000;

// Probes per sync. We keep the sample with the lowest round-trip time (NTP best-of-N): the
// shortest RTT has the least asymmetric-path error, so it yields the most accurate offset.
const PROBES_PER_SYNC = 5;

// Discard a probe whose round trip is implausibly long — its offset estimate is unreliable.
const MAX_ACCEPTABLE_RTT_MS = 3000;

// Only log a resync when the offset moves at least this much vs. the last logged value, to avoid
// noise from frequent refreshes that land on essentially the same offset.
const OFFSET_LOG_THRESHOLD_MS = 10;

interface Sample {
  offsetMs: number;
  rttMs: number;
}

/**
 * Public snapshot of the current sync state for one exchange.
 * - `synced`: whether a successful probe has ever landed (false → offset is the 0 default).
 * - `offsetMs`: serverClock − localClock in ms.
 * - `rttMs`: round-trip time of the best probe used for this offset.
 * - `confidenceMs`: half the RTT — the path-asymmetry uncertainty on the offset (and therefore on
 *   any latency corrected with it). A symmetric path would make this an exact bound.
 */
export interface ClockSyncInfo {
  synced: boolean;
  offsetMs: number;
  rttMs: number;
  confidenceMs: number;
}

/**
 * Estimates the clock offset (serverClock − localClock, in ms) between the user's browser and
 * each exchange's servers, so order-book latency can be corrected for local clock drift.
 *
 * Method (NTP-style single-timestamp): for each probe we record `t0` (local, before the request),
 * read the server's reported time, and record `t3` (local, after the response). Assuming a
 * symmetric path, the server clock at the local midpoint `(t0+t3)/2` equals the reported server
 * time, giving `offset = serverTime − (t0+t3)/2`. We take several probes and keep the one with the
 * smallest round-trip time. Offsets are cached with a TTL and refreshed lazily in the background.
 */
export class ClockSyncService {
  private offsets = new Map<ClockSyncExchange, number>();
  private rtts = new Map<ClockSyncExchange, number>();
  private expires = new Map<ClockSyncExchange, number>();
  private inflight = new Map<ClockSyncExchange, Promise<void>>();
  private lastLoggedOffset = new Map<ClockSyncExchange, number>();

  /**
   * Returns the cached offset (serverClock − localClock) in ms, or 0 if not yet measured.
   * Add this to a local timestamp to express it in the exchange's clock.
   *
   * @param exchange - The exchange whose offset to read.
   */
  getOffset(exchange: ClockSyncExchange): number {
    return this.offsets.get(exchange) ?? 0;
  }

  /**
   * Returns a snapshot of the current sync state for an exchange, including the offset, the RTT of
   * the probe it came from, and a confidence bound (± ms) derived from that RTT.
   *
   * @param exchange - The exchange whose sync info to read.
   */
  getSyncInfo(exchange: ClockSyncExchange): ClockSyncInfo {
    const rtt = this.rtts.get(exchange);
    const synced = this.offsets.has(exchange);

    return {
      synced,
      offsetMs: this.offsets.get(exchange) ?? 0,
      rttMs: rtt ?? 0,
      confidenceMs: rtt !== undefined ? rtt / 2 : 0,
    };
  }

  /**
   * Triggers a background offset refresh if the cached value is missing or stale. Non-blocking:
   * callers use whatever offset is currently available and benefit from the update next tick.
   *
   * @param exchange - The exchange to keep synced.
   */
  ensureFresh(exchange: ClockSyncExchange): void {
    const now = Date.now();
    const fresh = (this.expires.get(exchange) ?? 0) > now;

    if (fresh || this.inflight.has(exchange)) return;

    const run = this.sync(exchange).finally(() => this.inflight.delete(exchange));
    this.inflight.set(exchange, run);
  }

  /**
   * Runs the probe sequence for one exchange and updates the cached offset with the best sample.
   *
   * @param exchange - The exchange to probe.
   */
  private async sync(exchange: ClockSyncExchange): Promise<void> {
    let best: Sample | undefined;

    for (let i = 0; i < PROBES_PER_SYNC; i++) {
      const sample = await this.probe(exchange);

      if (!sample) continue;
      if (sample.rttMs > MAX_ACCEPTABLE_RTT_MS) continue;
      if (!best || sample.rttMs < best.rttMs) best = sample;
    }

    if (!best) {
      // No usable probe this round — back off before retrying so we don't hammer a down endpoint
      // on every book update. Any previously-cached offset is left untouched.
      this.expires.set(exchange, Date.now() + FAILURE_BACKOFF_MS);
      return;
    }

    this.offsets.set(exchange, best.offsetMs);
    this.rtts.set(exchange, best.rttMs);
    this.expires.set(exchange, Date.now() + OFFSET_TTL_MS);

    const prev = this.lastLoggedOffset.get(exchange);
    const isFirstSync = prev === undefined;
    const drifted = prev !== undefined && Math.abs(best.offsetMs - prev) >= OFFSET_LOG_THRESHOLD_MS;

    if (isFirstSync || drifted) {
      const direction = best.offsetMs >= 0 ? 'ahead of' : 'behind';
      const drift = !isFirstSync ? ` (Δ${(best.offsetMs - prev!).toFixed(1)}ms)` : '';

      console.debug(
        `[clock-sync] ${exchange}: offset=${best.offsetMs.toFixed(1)}ms ` +
          `(rtt=${best.rttMs.toFixed(0)}ms) — server clock ${direction} local${drift}`
      );

      this.lastLoggedOffset.set(exchange, best.offsetMs);
    }
  }

  /**
   * Performs a single server-time probe and returns the offset estimate and round-trip time,
   * or undefined on failure.
   *
   * @param exchange - The exchange to probe.
   */
  private async probe(exchange: ClockSyncExchange): Promise<Sample | undefined> {
    try {
      const t0 = Date.now();
      const serverTime = await this.fetchServerTime(exchange);
      const t3 = Date.now();

      if (serverTime === undefined) return undefined;

      const rttMs = t3 - t0;
      const offsetMs = serverTime - (t0 + t3) / 2;

      return { offsetMs, rttMs };
    } catch {
      return undefined;
    }
  }

  /**
   * Fetches the current server time (epoch ms) from an exchange's public time endpoint.
   *
   * @param exchange - The exchange to query.
   */
  private async fetchServerTime(exchange: ClockSyncExchange): Promise<number | undefined> {
    if (exchange === 'Binance') {
      const res = await fetch(`${BINANCE_FUTURES_REST_API_URL}/time`);

      if (!res.ok) return undefined;

      const data = (await res.json()) as { serverTime?: number };
      const t = Number(data?.serverTime);

      return Number.isFinite(t) ? t : undefined;
    }

    if (exchange === 'Bybit') {
      const res = await fetch(`${BYBIT_REST_API_URL}/market/time`);

      if (!res.ok) return undefined;

      const data = (await res.json()) as {
        time?: number;
        result?: { timeSecond?: string; timeNano?: string };
      };

      // v5 returns top-level `time` in ms; fall back to timeNano (ns) → ms.
      const t = Number(data?.time);

      if (Number.isFinite(t) && t > 0) return t;

      const nano = Number(data?.result?.timeNano);
      return Number.isFinite(nano) && nano > 0 ? nano / 1e6 : undefined;
    }

    // OKX
    const res = await fetch(`${OKX_REST_API_URL}/public/time`);

    if (!res.ok) return undefined;

    const data = (await res.json()) as { data?: Array<{ ts?: string }> };
    const t = Number(data?.data?.[0]?.ts);

    return Number.isFinite(t) ? t : undefined;
  }
}

export const clockSyncService = new ClockSyncService();
