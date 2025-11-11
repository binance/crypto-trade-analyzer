/**
 * The key for storing user account settings in localStorage.
 */
export const ACCOUNT_SETTINGS_STORAGE_KEY = 'cc:exchange-settings:v1';

/**
 * The key for storing the user's analytics consent preference in localStorage.
 */
export const GA4_ANALYTICS_CONSENT_KEY = 'ga4:analytics_consent';

/**
 * The current version of the Terms of Use.
 */
export const TERMS_VERSION = '2025-10-14';

/**
 * The key for storing whether the user has accepted the Terms of Use.
 */
export const TERMS_KEY = `terms:accepted:${TERMS_VERSION}`;

/**
 * The interval at which order book updates are emitted.
 */
export const EMIT_INTERVAL_MS = 1000;

/**
 * The threshold that we consider an orderbook stale if no updates are received.
 */
export const ORDERBOOK_STALE_MS = 30000;

/**
 * A set of stablecoin assets.
 */
export const STABLECOINS = new Set([
  'USD',
  'USDT',
  'USDC',
  'DAI',
  'BUSD',
  'TUSD',
  'USDP',
  'USDD',
  'FRAX',
  'LUSD',
  'USDN',
  'FDUSD',
  'PYUSD',
]);

/**
 * The maximum number of card slots allowed.
 */
export const MAX_CARD_SLOTS = 4;

/**
 * The number of rows to display in the live order book.
 */
export const LIVE_ORDER_BOOK_DEPTH_ROWS = 3;
