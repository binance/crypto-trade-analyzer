import { Decimal } from '../../utils/decimal';
import { withHttpRetry, isStablecoin } from '../../utils/utils';
import {
  readCacheEntryFromLocalStorage,
  writeCacheEntryToLocalStorage,
  removeKeyFromLocalStorage,
  clearByPrefixInLocalStorage,
  isFresh,
} from '../../utils/local-storage';

const LS_PREFIX = 'usdconv:v1:';
const LS_ID_MAP_KEY = `${LS_PREFIX}cgidmap`;
const LS_ID_RESOLVED_PREFIX = `${LS_PREFIX}cgid:`;
const ID_MAP_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const ID_RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const PRICE_SOURCE = 'coingecko';
const ID_MAP_PER_PAGE = 250;

interface CoinGeckoSimplePriceResponse {
  [id: string]: {
    usd?: number;
  };
}

interface CoinGeckoMarketsEntry {
  id: string;
  symbol: string;
}

interface CoinGeckoSearchResponse {
  coins?: Array<{
    id: string;
    symbol: string;
    market_cap_rank: number | null;
  }>;
}

export class USDConverter {
  private priceCache: Record<
    string,
    {
      usd: Decimal;
      expires: number;
      source: string;
    }
  > = {};
  private inflightRequests: Record<string, Promise<{ price: Decimal; source: string }>> = {};
  private idMap: Record<string, string> = {};
  private idMapTs = 0;
  private inflightIdMap: Promise<Record<string, string>> | null = null;

  constructor(private cacheTtlMs: number = 60000) {}

  /**
   * Get the local storage key for a symbol.
   *
   * @private
   * @param symbol The cryptocurrency symbol
   * @returns The local storage key
   */
  private getLocalStorageKey(symbol: string): string {
    return `${LS_PREFIX}${symbol.toUpperCase()}`;
  }

  /**
   * Remove a value from local storage.
   *
   * @private
   * @param symbol The cryptocurrency symbol
   * @returns
   */
  private removeFromLocalStorage(symbol?: string): void {
    if (symbol) removeKeyFromLocalStorage(this.getLocalStorageKey(symbol));
    else clearByPrefixInLocalStorage(LS_PREFIX);
  }

  /**
   * Resolve a ticker symbol to a CoinGecko coin id.
   *
   * CoinGecko's free `/simple/price` endpoint keys off coin id (`bitcoin`), not
   * ticker (`btc`), and tickers collide across many coins. Resolution order:
   *   1. the market-cap-ranked top-{@link ID_MAP_PER_PAGE} map (covers the assets
   *      we normally convert; collisions resolve to the dominant coin),
   *   2. `/search` for the exact ticker, picking the best-ranked match — handles
   *      long-tail coins outside the top map; result cached per-symbol for 30d,
   *   3. the lowercased ticker as a last-ditch guess (only when both lookups fail).
   *
   * @private
   * @param symbol The cryptocurrency ticker (e.g. 'BTC').
   * @returns The best-known CoinGecko coin id.
   */
  private async resolveCoinGeckoId(symbol: string): Promise<string> {
    const upper = symbol.toUpperCase();

    const map = await this.getIdMap();
    if (map[upper]) return map[upper];

    const resolved = await this.searchCoinGeckoId(upper);
    return resolved ?? symbol.toLowerCase();
  }

  /**
   * Resolve a ticker to a coin id via CoinGecko's `/search` endpoint, for coins
   * outside the top-market-cap map. Filters to exact ticker matches (search also
   * returns fuzzy hits) and picks the highest market cap (lowest rank). The
   * resolved id is cached per-symbol in localStorage for 30 days — coin ids are
   * stable, so this rarely re-hits the network for the same asset.
   *
   * @private
   * @param upperSymbol The upper-cased cryptocurrency ticker.
   * @returns The resolved coin id, or null if none found or the request failed.
   */
  private async searchCoinGeckoId(upperSymbol: string): Promise<string | null> {
    const cacheKey = `${LS_ID_RESOLVED_PREFIX}${upperSymbol}`;
    const cached = readCacheEntryFromLocalStorage<string>(cacheKey);
    if (cached && isFresh(cached.ts, ID_RESOLVED_TTL_MS)) return cached.data;

    try {
      const url = `${COINGECKO_API}/search?query=${encodeURIComponent(upperSymbol)}`;
      const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3, baseDelayMs: 500 });
      const data = (await resp.json()) as CoinGeckoSearchResponse;

      const match = (data.coins ?? [])
        .filter((c) => c?.id && c?.symbol?.toUpperCase() === upperSymbol)
        .sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity))[0];

      if (!match) return null;

      writeCacheEntryToLocalStorage(cacheKey, match.id);
      return match.id;
    } catch (error) {
      console.warn(`CoinGecko id search failed for ${upperSymbol}:`, error);
      return null;
    }
  }

  /**
   * Lazily build/refresh a ticker → coin-id map from CoinGecko's market-cap
   * ranking. The endpoint returns coins ordered by market cap, so keeping the
   * first id seen per ticker resolves collisions to the dominant coin.
   *
   * @private
   * @returns A map of upper-cased ticker to CoinGecko coin id.
   */
  private async getIdMap(): Promise<Record<string, string>> {
    const now = Date.now();
    if (Object.keys(this.idMap).length && now - this.idMapTs < ID_MAP_TTL_MS) return this.idMap;

    const cached = readCacheEntryFromLocalStorage<Record<string, string>>(LS_ID_MAP_KEY);
    if (cached && isFresh(cached.ts, ID_MAP_TTL_MS)) {
      this.idMap = cached.data;
      this.idMapTs = cached.ts;
      return this.idMap;
    }

    if (this.inflightIdMap) return this.inflightIdMap;

    this.inflightIdMap = (async () => {
      try {
        const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${ID_MAP_PER_PAGE}&page=1`;
        const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3, baseDelayMs: 500 });
        const data = (await resp.json()) as CoinGeckoMarketsEntry[];

        const map: Record<string, string> = {};
        for (const entry of data) {
          const ticker = entry?.symbol?.toUpperCase();
          if (ticker && entry?.id && !map[ticker]) map[ticker] = entry.id;
        }

        this.idMap = map;
        this.idMapTs = Date.now();
        writeCacheEntryToLocalStorage(LS_ID_MAP_KEY, map);
        return map;
      } catch (error) {
        console.warn('Failed to build CoinGecko id map:', error);
        return this.idMap;
      } finally {
        this.inflightIdMap = null;
      }
    })();

    return this.inflightIdMap;
  }

  /**
   * Fetch price from CoinGecko API
   *
   * @private
   * @param symbol The cryptocurrency symbol
   * @returns The USD price
   */
  private async fetchFromCoinGecko(symbol: string): Promise<number> {
    const id = await this.resolveCoinGeckoId(symbol);
    const url = `${COINGECKO_API}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`;

    const resp = await withHttpRetry(() => fetch(url), {
      maxAttempts: 3,
      baseDelayMs: 500,
    });

    const data = (await resp.json()) as CoinGeckoSimplePriceResponse;
    const rate = data?.[id]?.usd;
    if (typeof rate !== 'number') throw new Error('No USD price data');

    return rate;
  }

  /**
   * Fetch the USD price for a symbol, de-duplicating concurrent requests for the
   * same asset via an in-flight promise cache.
   *
   * @private
   * @param symbol The cryptocurrency symbol
   * @returns The USD price and the source API
   */
  private async fetchUSDPrice(symbol: string): Promise<{ price: Decimal; source: string }> {
    const key = symbol.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(this.inflightRequests, key))
      return this.inflightRequests[key];

    const fetchPromise = (async () => {
      const price = await this.fetchFromCoinGecko(symbol);
      return { price: new Decimal(price), source: PRICE_SOURCE };
    })();

    this.inflightRequests[key] = fetchPromise;

    try {
      return await fetchPromise;
    } finally {
      delete this.inflightRequests[key];
    }
  }

  /**
   * Converts a specified asset amount to its USD equivalent.
   *
   * - If the asset is a stablecoin, returns the original amount.
   * - Otherwise, attempts to retrieve the USD price from an in-memory cache, local storage, or fetches it from an external source.
   * - Caches the fetched price in both memory and local storage for future use.
   * - Throws an error if the conversion fails.
   *
   * @param asset - The symbol of the asset to convert (e.g., 'BTC', 'ETH').
   * @param amount - The amount of the asset to convert, as a `Decimal`.
   * @returns A promise that resolves to the USD equivalent of the given asset amount as a `Decimal`.
   * @throws {Error} If the conversion to USD fails.
   */
  async convert(asset: string, amount: Decimal): Promise<Decimal> {
    const symbol = asset.toUpperCase();

    if (isStablecoin(symbol)) return amount;

    const now = Date.now();

    const mem = this.priceCache[symbol];
    if (mem && mem.expires > now) return amount.mul(mem.usd);

    const cached = readCacheEntryFromLocalStorage<number, { source?: string }>(
      this.getLocalStorageKey(symbol)
    );
    if (cached && isFresh(cached.ts, this.cacheTtlMs)) {
      const usd = new Decimal(cached.data);
      this.priceCache[symbol] = {
        usd,
        expires: cached.ts + this.cacheTtlMs,
        source: cached?.meta?.source || 'cache',
      };
      return amount.mul(usd);
    }

    try {
      const { price, source } = await this.fetchUSDPrice(symbol);

      this.priceCache[symbol] = {
        usd: price,
        expires: now + this.cacheTtlMs,
        source,
      };
      writeCacheEntryToLocalStorage<number, { source: string }>(
        this.getLocalStorageKey(symbol),
        price.toNumber(),
        { source }
      );

      return amount.mul(price);
    } catch (error) {
      throw new Error(`Failed to convert ${asset} to USD: ${error}`);
    }
  }

  /**
   * Get price info including source
   *
   * @param asset The asset to get price info for
   * @returns The price info object
   */
  async getPriceInfo(asset: string): Promise<{ price: Decimal; source: string; cached: boolean }> {
    const symbol = asset.toUpperCase();
    const now = Date.now();

    const mem = this.priceCache[symbol];
    if (mem && mem.expires > now) return { price: mem.usd, source: mem.source, cached: true };

    const cached = readCacheEntryFromLocalStorage<number, { source?: string }>(
      this.getLocalStorageKey(symbol)
    );
    if (cached && isFresh(cached.ts, this.cacheTtlMs)) {
      const price = new Decimal(cached.data);
      this.priceCache[symbol] = {
        usd: price,
        expires: cached.ts + this.cacheTtlMs,
        source: cached?.meta?.source || 'cache',
      };
      return { price, source: cached?.meta?.source || 'cache', cached: true };
    }

    const { price, source } = await this.fetchUSDPrice(symbol);
    return { price, source, cached: false };
  }

  /**
   * Clear cache for a specific asset or all assets
   *
   * @param asset
   */
  clearCache(asset?: string): void {
    if (asset) {
      delete this.priceCache[asset.toUpperCase()];
      this.removeFromLocalStorage(asset);
    } else {
      this.priceCache = {};
      this.removeFromLocalStorage();
    }
  }
}
