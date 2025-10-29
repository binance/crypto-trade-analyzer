/**
 * Represents a cached entry with timestamp, data, and optional metadata.
 *
 * @template T - The type of the cached data
 * @template M - The type of the metadata, defaults to Record<string, unknown>
 *
 * @property {number} ts - Timestamp when the entry was cached
 * @property {T} data - The cached data
 * @property {M} [meta] - Optional metadata associated with the cached entry
 */
export type CacheEntry<T, M = Record<string, unknown>> = {
  ts: number;
  data: T;
  meta?: M;
};

let _store: Storage | null | undefined;

/**
 * Safely retrieves the localStorage object or returns null if not available.
 *
 * This function attempts to access the browser's localStorage API and verifies
 * that it's working properly by performing a test write/delete operation.
 * It handles various edge cases such as:
 * - Running in environments where localStorage isn't available
 * - Browsers with privacy settings that block localStorage access
 * - Incognito/private browsing modes
 *
 * The function caches its result internally to avoid repeated checks.
 *
 * @returns The localStorage object if available and working, or null otherwise
 */
function getLocalStorageStore(): Storage | null {
  if (_store !== undefined) return _store;
  try {
    const w =
      typeof globalThis !== 'undefined'
        ? (globalThis as unknown as Window & typeof globalThis)
        : undefined;
    if (!w?.localStorage) return (_store = null);
    const k = '__ls_test__';
    w.localStorage.setItem(k, '1');
    w.localStorage.removeItem(k);
    return (_store = w.localStorage);
  } catch {
    return (_store = null);
  }
}

/**
 * Reads and parses a JSON value from localStorage.
 *
 * @template T - The expected type of the stored JSON value, defaults to unknown
 * @param {string} key - The key under which the value is stored in localStorage
 * @returns {T | null} The parsed JSON value cast to type T, or null if:
 *   - localStorage is not available
 *   - The key doesn't exist in localStorage
 *   - There's an error parsing the JSON
 */
export function readJSONFromLocalStorage<T = unknown>(key: string): T | null {
  const s = getLocalStorageStore();
  if (!s) return null;

  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Stores a value in localStorage as a JSON string.
 *
 * @param key - The key under which to store the value in localStorage
 * @param value - The value to be stored, which will be JSON-stringified
 * @returns void
 *
 * @remarks
 * This function silently fails if localStorage is not available or if the value
 * cannot be stringified. When localStorage write fails, a warning is logged to the console.
 *
 * @example
 * ```ts
 * writeJSON('user', { name: 'John', age: 30 });
 * ```
 */
export function writeJSONToLocalStorage(key: string, value: unknown): void {
  const s = getLocalStorageStore();
  if (!s) return;

  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    console.warn('localStorage write failed');
  }
}

/**
 * Removes an item from local storage by its key.
 * @param key The key of the item to remove from local storage
 * @returns void
 * @remarks If local storage is not available or the operation fails, a warning is logged to the console.
 */
export function removeKeyFromLocalStorage(key: string): void {
  const s = getLocalStorageStore();
  if (!s) return;

  try {
    s.removeItem(key);
  } catch {
    console.warn('localStorage remove failed');
  }
}

/**
 * Removes all items from localStorage whose keys start with the specified prefix.
 *
 * @param prefix - The string prefix to match against localStorage keys
 * @returns void
 *
 * @remarks
 * This function iterates through all localStorage keys, identifies those that
 * start with the given prefix, and removes them. If the operation fails,
 * a warning is logged to the console.
 *
 * @example
 * ```typescript
 * // Remove all items with keys starting with "user-"
 * clearByPrefix("user-");
 * ```
 */
export function clearByPrefixInLocalStorage(prefix: string): void {
  const s = getLocalStorageStore();
  if (!s) return;

  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    console.warn('localStorage clear-by-prefix failed');
  }
}

/**
 * Reads a cache entry from localStorage by the given key.
 *
 * @typeParam T - The type of data stored in the cache entry. Defaults to unknown.
 * @typeParam M - The type of metadata stored in the cache entry. Defaults to Record<string, unknown>.
 *
 * @param key - The localStorage key to read from.
 *
 * @returns The cache entry if it exists and has valid structure (contains a numeric timestamp and data),
 * or null if the entry doesn't exist or has invalid structure.
 */
export function readCacheEntryFromLocalStorage<T = unknown, M = Record<string, unknown>>(
  key: string
): CacheEntry<T, M> | null {
  const v = readJSONFromLocalStorage<CacheEntry<T, M>>(key);
  return v && typeof v.ts === 'number' && 'data' in v ? v : null;
}

/**
 * Writes data to localStorage as a cache entry with a timestamp.
 *
 * @template T - The type of the data to be stored
 * @template M - The type of the metadata, defaults to Record<string, unknown>
 * @param key - The key under which to store the data in localStorage
 * @param data - The data to be cached
 * @param meta - Optional metadata to store alongside the data
 */
export function writeCacheEntryToLocalStorage<T, M = Record<string, unknown>>(
  key: string,
  data: T,
  meta?: M
): void {
  writeJSONToLocalStorage(key, { ts: Date.now(), data, meta });
}

/**
 * Determines if a timestamp is fresh by checking if it's within the specified maximum age.
 *
 * @param ts - The timestamp (in milliseconds) to check for freshness
 * @param maxAgeMs - The maximum age (in milliseconds) for the timestamp to be considered fresh
 * @returns `true` if the timestamp is fresh (difference between now and timestamp is less than maxAgeMs), `false` otherwise
 */
export function isFresh(ts: number, maxAgeMs: number): boolean {
  return Date.now() - ts < maxAgeMs;
}
