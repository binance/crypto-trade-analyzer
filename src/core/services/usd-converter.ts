import { STABLECOINS } from '../../utils/constants';
import { Decimal } from '../../utils/decimal';
import { withHttpRetry } from '../../utils/utils';
import {
  readCacheEntryFromLocalStorage,
  writeCacheEntryToLocalStorage,
  removeKeyFromLocalStorage,
  clearByPrefixInLocalStorage,
  isFresh,
} from '../../utils/local-storage';

const LS_PREFIX = 'usdconv:v1:';

interface PriceAPI {
  name: string;
  fetchPrice: (symbol: string) => Promise<number>;
}

interface CryptoCompareResponse {
  USD?: number;
  Response?: string;
  Message?: string;
}

interface CoinGeckoResponse {
  [key: string]: {
    usd?: number;
  };
}

export class USDConverter {
  private apis: PriceAPI[];
  private priceCache: Record<
    string,
    {
      usd: Decimal;
      expires: number;
      source: string;
    }
  > = {};
  private inflightRequests: Record<string, Promise<{ price: Decimal; source: string }>> = {};

  constructor(private cacheTtlMs: number = 60000) {
    this.apis = [
      {
        name: 'cryptocompare',
        fetchPrice: this.fetchFromCryptoCompare.bind(this),
      },
      {
        name: 'coingecko',
        fetchPrice: this.fetchFromCoinGecko.bind(this),
      },
    ];
  }

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
   * Fetch price from CryptoCompare API
   *
   * @private
   * @param symbol The cryptocurrency symbol
   * @returns The USD price
   */
  private async fetchFromCryptoCompare(symbol: string): Promise<number> {
    const url = `https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=USD`;

    const resp = await withHttpRetry(() => fetch(url), {
      maxAttempts: 3,
      baseDelayMs: 200,
    });

    const data = (await resp.json()) as CryptoCompareResponse;
    if (typeof data?.USD !== 'number') throw new Error('No USD price data');

    return data.USD;
  }

  /**
   * Fetch price from CoinGecko API
   *
   * @private
   * @param symbol The cryptocurrency symbol
   * @returns The USD price
   */
  private async fetchFromCoinGecko(symbol: string): Promise<number> {
    const url = `https://api.coingecko.com/api/v3/simple/price?symbols=${symbol}&vs_currencies=usd`;

    const resp = await withHttpRetry(() => fetch(url), {
      maxAttempts: 3,
      baseDelayMs: 500,
    });

    const data = (await resp.json()) as CoinGeckoResponse;
    const rate = data?.[symbol.toLowerCase()]?.usd;
    if (typeof rate !== 'number') throw new Error('No USD price data');

    return rate;
  }

  /**
   * Fetch USD price from multiple APIs
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
      let lastError: Error | null = null;

      for (const api of this.apis) {
        try {
          console.debug(`Attempting to fetch ${symbol} price from ${api.name}`);
          const price = await api.fetchPrice(symbol);
          console.debug(`Successfully fetched ${symbol} price from ${api.name}: $${price}`);

          return {
            price: new Decimal(price),
            source: api.name,
          };
        } catch (error) {
          lastError = error as Error;
          console.warn(`${api.name} failed for ${symbol}:`, error);
        }
      }
      throw new Error(
        `All APIs failed for ${symbol}. Last error: ${lastError?.message || 'Unknown error'}`
      );
    })();

    this.inflightRequests[key] = fetchPromise;

    try {
      const result = await fetchPromise;
      return result;
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

    if (STABLECOINS.has(symbol)) return amount;

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
