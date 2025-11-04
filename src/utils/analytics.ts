import { GA4_ANALYTICS_CONSENT_KEY } from './constants';
import type { OrderSide } from '../core/interfaces/order-book';
import type { PerExchangeSettings } from '../app/types';

type GA4Window = Window & {
  doNotTrack?: string;
  gtag?: (event: string, name: string, props?: Record<string, unknown>) => void;
};

type GA4Navigator = Navigator & { msDoNotTrack?: string; doNotTrack?: string };

/**
 * Checks if the "Do Not Track" (DNT) setting is enabled in the user's browser.
 *
 * This function inspects various browser-specific properties to determine if the user has requested
 * not to be tracked. It checks the `doNotTrack` property on both the `navigator` and `window` objects,
 * as well as the legacy `msDoNotTrack` property for Internet Explorer.
 *
 * @returns {boolean} `true` if DNT is enabled, otherwise `false`.
 */
export function doNotTrackEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  const dnt =
    (navigator as GA4Navigator).doNotTrack ||
    (window as GA4Window).doNotTrack ||
    (navigator as GA4Navigator).msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

/**
 * Determines whether analytics tracking is enabled for the user.
 *
 * Analytics is considered enabled if the "Do Not Track" setting is not active
 * and the user has not opted out via local storage.
 *
 * @returns {boolean} `true` if analytics tracking is enabled, `false` otherwise.
 */
export function isAnalyticsEnabled(): boolean {
  return getStoredConsent() === 'granted' && !doNotTrackEnabled();
}

/**
 * Enables or disables analytics tracking by setting a flag in localStorage.
 *
 * When `enabled` is `false`, sets the consent key in localStorage to indicate
 * that analytics are disabled. When `enabled` is `true`, removes the consent key,
 * enabling analytics tracking.
 *
 * @param enabled - A boolean indicating whether analytics should be enabled.
 */
export function setAnalyticsEnabled(enabled: boolean) {
  setStoredConsent(enabled ? 'granted' : 'denied');
  syncGAConsent();
}

/**
 * Retrieves the user's analytics consent status from localStorage.
 *
 * If the consent status is not set, it defaults to `'granted'`.
 * Returns `'granted'`, `'denied'`, or `null` if the value is not recognized or
 * if executed in a non-browser environment.
 *
 * @returns {'granted' | 'denied' | null} The stored consent status.
 */
export function getStoredConsent(): 'granted' | 'denied' | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(GA4_ANALYTICS_CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

/**
 * Sets the user's consent status for analytics in local storage.
 *
 * @param v - The consent status, either `'granted'` or `'denied'`.
 */
export function setStoredConsent(v: 'granted' | 'denied') {
  localStorage.setItem(GA4_ANALYTICS_CONSENT_KEY, v);
}

/**
 * Updates Google Analytics 4 (GA4) consent status for analytics storage.
 *
 * This function sets the user's consent for analytics storage by calling
 * the GA4 `gtag` function with the appropriate consent value.
 *
 * @param granted - Indicates whether analytics storage consent is granted (`true`) or denied (`false`).
 */
function updateGAConsent(granted: boolean) {
  const win = window as GA4Window;
  if (!win.gtag) return;
  const consent = granted ? 'granted' : 'denied';
  win.gtag('consent', 'update', {
    analytics_storage: consent,
    ad_storage: consent,
    ad_user_data: consent,
    ad_personalization: consent,
  });
}

/**
 * Synchronizes the Google Analytics (GA) consent status by updating it
 * based on the current analytics enablement setting.
 *
 * This function checks whether analytics are enabled and updates the GA consent
 * accordingly.
 */
export function syncGAConsent() {
  if (typeof window === 'undefined') return;
  const granted = isAnalyticsEnabled();
  updateGAConsent(granted);
}

/**
 * Checks if Google Analytics (gtag) is available on the global `window` object.
 *
 * @returns {boolean} `true` if the `gtag` function exists on `window`, otherwise `false`.
 */
function hasGA(): boolean {
  const win = window as Window & { gtag?: unknown };
  return typeof win.gtag === 'function';
}

/**
 * Sends an analytics event using Google Analytics (gtag).
 *
 * The event is only sent if analytics are enabled and Google Analytics is available.
 *
 * @param name - The name of the event to send.
 * @param props - Optional properties to include with the event.
 */
export function sendEvent(name: string, props?: Record<string, unknown>) {
  if (!isAnalyticsEnabled() || !hasGA()) return;
  const win = window as GA4Window;
  if (typeof win.gtag === 'function') {
    const eventProps = { ...(props || {}) };
    win.gtag('event', name, eventProps);
  }
}

/**
 * Emits an analytics event when a trading pair is selected.
 *
 * @param tradingPair - The trading pair that was selected.
 * @param base - The base asset of the selected trading pair.
 * @param quote - The quote asset of the selected trading pair.
 */
export function evtTradingPairSelected(tradingPair: string, base: string, quote: string) {
  sendEvent('trading_pair_selected', { trading_pair: tradingPair, base, quote, ts: Date.now() });
}

/**
 * Sends an analytics event indicating which exchanges have been selected.
 *
 * @param exchanges - An array of exchange names selected by the user.
 * The exchanges are joined into a comma-separated string and sent along with a timestamp.
 */
export function evtExchangesSelected(exchanges: string[]) {
  sendEvent('exchanges_selected', { exchanges: exchanges.join(','), ts: Date.now() });
}

/**
 * Emits an analytics event when a calculation is performed for a crypto exchange comparison.
 *
 * @param params - The parameters for the calculation event.
 * @param params.tradingPair - The trading pair (e.g., 'BTC-USDT').
 * @param params.side - The side of the trade, either 'buy' or 'sell'.
 * @param params.quantity - The quantity involved in the calculation.
 * @param params.selectedExchanges - Array of selected exchange names.
 * @param params.bestExchange - The name of the exchange with the best rate.
 * @param params.bestExchangeAccountPrefs - (Optional) Account preferences for the best exchange.
 * @param params.binanceRank - (Optional) The rank of Binance among selected exchanges.
 * @param params.binanceComparator - (Optional) The exchange used as a comparator for Binance.
 * @param params.binanceVsComparatorPct - (Optional) Percentage difference between Binance and the comparator exchange.
 *
 * @remarks
 * This function transforms the input parameters, adds a timestamp, and sends an event named 'calc_performed'.
 */
export function evtCalcPerformed(params: {
  tradingPair: string;
  side: OrderSide;
  quantity: number;
  sizeAsset: string;
  selectedExchanges: string[];
  bestExchange: string;
  bestExchangeAccountPrefs?: PerExchangeSettings | object;
  binanceRank?: number;
  binanceComparator?: string;
  binanceVsComparatorPct?: number;
}) {
  const p = {
    trading_pair: params.tradingPair,
    side: params.side,
    quantity: params.quantity,
    size_asset: params.sizeAsset,
    selected_exchanges: params.selectedExchanges.join(','),
    selected_exchanges_count: params.selectedExchanges.length || 0,
    best_exchange: params.bestExchange,
    best_exchange_user_tier:
      params.bestExchangeAccountPrefs && 'userTier' in params.bestExchangeAccountPrefs
        ? params.bestExchangeAccountPrefs.userTier
        : '',
    best_exchange_token_discount:
      params.bestExchangeAccountPrefs && 'tokenDiscount' in params.bestExchangeAccountPrefs
        ? params.bestExchangeAccountPrefs.tokenDiscount
          ? 1
          : 0
        : 0,
    best_exchange_custom_fees:
      params.bestExchangeAccountPrefs && 'customFees' in params.bestExchangeAccountPrefs
        ? params.bestExchangeAccountPrefs.customFees
          ? params.bestExchangeAccountPrefs.customFees
          : 0
        : 0,
    binance_rank: params.binanceRank ?? -1,
    binance_comparator: params.binanceComparator || '',
    binance_vs_comparator_pct: Math.round((params.binanceVsComparatorPct ?? 0) * 10000) / 10000,
    ts: Date.now(),
  };
  sendEvent('calc_performed', p);
}

/**
 * Sends a latency calculation event for a given exchange, categorizing the latency in milliseconds into predefined buckets.
 *
 * @param exchange - The name of the exchange for which the latency is being measured.
 * @param ms - The measured latency in milliseconds.
 *
 * Buckets:
 * - '<50' for latencies less than 50ms
 * - '50-100' for latencies between 50ms and 100ms
 * - '100-200' for latencies between 100ms and 200ms
 * - '200-500' for latencies between 200ms and 500ms
 * - '500-1000' for latencies between 500ms and 1000ms
 * - '>=1000' for latencies greater than or equal to 1000ms
 *
 * The event is sent with the name 'calc_latency' and includes the exchange, latency value, and bucket.
 */
export function evtCalcLatencyMs(exchange: string, ms: number) {
  const bucket =
    ms < 50
      ? '<50'
      : ms < 100
        ? '50-100'
        : ms < 200
          ? '100-200'
          : ms < 500
            ? '200-500'
            : ms < 1000
              ? '500-1000'
              : '>=1000';

  sendEvent('calc_latency', {
    exchange,
    calc_latency_ms: Math.floor(ms),
    calc_latency_bucket: bucket,
  });
}

/**
 * Sends an analytics event for orderbook push latency, categorizing the latency into predefined buckets.
 *
 * @param exchange - The name of the exchange where the orderbook push occurred.
 * @param ms - The latency in milliseconds to be categorized and reported.
 *
 * Buckets:
 * - '<50' for latencies less than 50ms
 * - '50-100' for latencies between 50ms and 100ms
 * - '100-200' for latencies between 100ms and 200ms
 * - '200-500' for latencies between 200ms and 500ms
 * - '500-1000' for latencies between 500ms and 1000ms
 * - '>=1000' for latencies greater than or equal to 1000ms
 */
export function evtOrderbookPushLatencyMs(exchange: string, ms: number) {
  const bucket =
    ms < 50
      ? '<50'
      : ms < 100
        ? '50-100'
        : ms < 200
          ? '100-200'
          : ms < 500
            ? '200-500'
            : ms < 1000
              ? '500-1000'
              : '>=1000';

  sendEvent('orderbook_push_latency', {
    exchange,
    order_book_latency_ms: Math.floor(ms),
    order_book_latency_bucket: bucket,
  });
}

/**
 * Sends an analytics event indicating the status of a cryptocurrency exchange.
 *
 * @param params - The parameters for the event.
 * @param params.exchange - The name of the exchange.
 * @param params.status - The current status of the exchange ('up' or 'down').
 * @param params.reason - Optional reason for the status change.
 * @param params.down_duration_ms - Optional duration in milliseconds that the exchange has been down.
 *
 * @remarks
 * The event is sent with the name 'exchange_status' and includes a timestamp.
 * If the `down_duration_ms` is provided, it is ensured to be a non-negative integer.
 * If the `reason` is not provided, it defaults to an empty string.
 * The timestamp is added to the event parameters to indicate when the status was recorded.
 * The event is sent using the `sendEvent` function.
 * This function is useful for monitoring the availability and status of exchanges in real-time.
 */
export function evtExchangeStatus(params: {
  exchange: string;
  status: 'up' | 'down';
  reason?: string;
  down_duration_ms?: number;
}) {
  sendEvent('exchange_status', {
    exchange: params.exchange,
    status: params.status,
    reason: params.reason ?? '',
    ...(typeof params.down_duration_ms === 'number' && isFinite(params.down_duration_ms)
      ? { down_duration_ms: Math.max(0, Math.floor(params.down_duration_ms)) }
      : {}),
    ts: Date.now(),
  });
}

/**
 * Tracks when a user starts a session with a specific cryptocurrency exchange.
 * Sends an analytics event with the exchange name and current timestamp.
 *
 * @param exchange - The name of the cryptocurrency exchange being accessed
 */
export function evtExchangeSessionStart(exchange: string) {
  sendEvent('exchange_session_start', { exchange, ts: Date.now() });
}

/**
 * Sends an analytics event when an exchange session ends.
 *
 * @param exchange - The name of the exchange where the session ended
 * @param reason - Optional reason for the session ending. Defaults to empty string if not provided
 */
export function evtExchangeSessionEnd(exchange: string, reason?: string) {
  sendEvent('exchange_session_end', { exchange, reason: reason ?? '', ts: Date.now() });
}

/**
 * Records an analytics event for an exchange session summary with uptime/downtime metrics.
 *
 * @param params - The session summary parameters
 * @param params.exchange - Name of the exchange
 * @param params.total_ms - Total session duration in milliseconds
 * @param params.downtime_ms - Total downtime duration in milliseconds
 * @param params.uptime_ratio - Ratio of uptime (0-1)
 * @param params.reason - Optional reason for session end or downtime
 *
 * @remarks
 * - `total_ms` and `downtime_ms` are floored and clamped to minimum value of 0
 * - `uptime_ratio` is clamped between 0 and 1
 * - Automatically adds a timestamp (`ts`) when the event is recorded
 */
export function evtExchangeSessionSummary(params: {
  exchange: string;
  total_ms: number;
  downtime_ms: number;
  uptime_ratio: number;
  reason?: string;
}) {
  const props = {
    exchange: params.exchange,
    total_ms: Math.max(0, Math.floor(params.total_ms)),
    downtime_ms: Math.max(0, Math.floor(params.downtime_ms)),
    uptime_ratio: Math.max(0, Math.min(1, params.uptime_ratio)),
    reason: params.reason ?? '',
    ts: Date.now(),
  };
  sendEvent('exchange_session_summary', props);
}
