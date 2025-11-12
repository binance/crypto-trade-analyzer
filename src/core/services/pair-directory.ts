import { EXCHANGE_REGISTRY } from '../../exchanges';
import { withHttpRetry } from '../../utils/utils';
import {
  readCacheEntryFromLocalStorage,
  writeCacheEntryToLocalStorage,
  removeKeyFromLocalStorage,
  isFresh,
} from '../../utils/local-storage';
import { REST_API_URL as BINANCE_REST_API_URL } from '../../exchanges/binance/utils/constants';
import { REST_API_URL as BYBIT_REST_API_URL } from '../../exchanges/bybit/utils/constants';
import { REST_API_URL as COINBASE_REST_API_URL } from '../../exchanges/coinbase/utils/constants';
import { REST_API_URL as OKX_REST_API_URL } from '../../exchanges/okx/utils/constants';

const LS_PREFIX = 'pairdir:v1';
const PAPRIKA_SLUG: Record<string, string> = {
  Binance: 'binance',
  OKX: 'okx',
  Bybit: 'bybit-spot',
  Coinbase: 'coinbase',
};

const INFLIGHT_BY_EXCHANGE = new Map<string, Promise<Pair[]>>();
let INFLIGHT_SYMBOLS: Promise<Map<string, string>> | undefined;
let INFLIGHT_PAIRS_WITH_EX: Promise<PairWithExchanges[]> | undefined;

interface ExchangeMarketResponse {
  category?: string;
  base_currency_id?: string;
  base_currency_name?: string;
  quote_currency_id?: string;
  quote_currency_name?: string;
  pair?: string;
}

type Pair = { base: string; quote: string; display: string };
type Coin = { id: string; symbol: string };
type Fiat = { id: string; symbol: string };

type Options = {
  cacheTtlMs?: number;
  exchanges?: string[];
};

export type PairWithExchanges = Pair & { exchanges: string[] };

export class PairDirectory {
  private cachePairs: Pair[] | null = null;
  private cacheTs = 0;
  private cachePairsWithEx?: PairWithExchanges[];
  private cacheWithExTs = 0;
  private pending?: Promise<Pair[]>;
  private symbolsById?: Map<string, string>;
  private symbolsTs = 0;

  private readonly cacheTtlMs: number;
  private readonly exchanges: string[];

  constructor(opts: Options = {}) {
    this.cacheTtlMs = opts.cacheTtlMs ?? 30 * 60 * 1000; // 30 min
    this.exchanges = opts.exchanges ?? Object.keys(EXCHANGE_REGISTRY);
  }

  /**
   * Get the local storage key for pairs.
   *
   * @private
   * @returns The local storage key for pairs.
   */
  private getLocalStorageKeyPairs(): string {
    const ex = [...this.exchanges].sort().join(',');
    return `${LS_PREFIX}:pairs:${ex}`;
  }

  /**
   * Get the local storage key for pairs with exchanges.
   *
   * @private
   * @returns The local storage key for pairs with exchanges.
   */
  private getLocalStorageKeyPairsWithEx(): string {
    const ex = [...this.exchanges].sort().join(',');
    return `${LS_PREFIX}:pairsWithEx:${ex}`;
  }

  /**
   * Build/refresh a map of coin+fiat IDs → SYMBOL (BTC, ETH, USD, EUR, …).
   *
   * @private
   * @returns A promise that resolves to a map of coin+fiat IDs to their symbols.
   */
  private async getSymbolsMap(): Promise<Map<string, string>> {
    const now = Date.now();

    if (this.symbolsById && isFresh(this.symbolsTs, this.cacheTtlMs)) return this.symbolsById;
    if (INFLIGHT_SYMBOLS) return INFLIGHT_SYMBOLS;

    INFLIGHT_SYMBOLS = (async () => {
      const [coinsRes, fiatsRes] = await Promise.all([
        withHttpRetry(() => fetch('https://api.coinpaprika.com/v1/coins'), { maxAttempts: 5 }),
        withHttpRetry(() => fetch('https://api.coinpaprika.com/v1/fiats'), { maxAttempts: 5 }),
      ]);
      if (!coinsRes.ok) throw new Error(`Failed to fetch coins ${coinsRes.status}`);
      if (!fiatsRes.ok) throw new Error(`Failed to fetch fiats ${fiatsRes.status}`);

      const coins = (await coinsRes.json()) as Coin[];
      const fiats = (await fiatsRes.json()) as Fiat[];

      const map = new Map<string, string>();
      for (const coin of coins)
        if (coin?.id && coin?.symbol) map.set(coin.id, coin.symbol.toUpperCase());
      for (const fiat of fiats)
        if (fiat?.id && fiat?.symbol) map.set(fiat.id, fiat.symbol.toUpperCase());

      this.symbolsById = map;
      this.symbolsTs = now;
      return map;
    })();

    try {
      return await INFLIGHT_SYMBOLS;
    } finally {
      INFLIGHT_SYMBOLS = undefined;
    }
  }

  /**
   * Fetches trading pairs from the Binance exchange API.
   *
   * This method retrieves all available trading pairs from Binance,
   * filters for only those with 'TRADING' status, and transforms them
   * into standardized Pair objects with base, quote, and display properties.
   *
   * @private
   * @returns {Promise<Pair[]>} A promise that resolves to an array of standardized trading pairs
   * @throws {Error} If the API request fails or returns a non-200 status code
   */
  private async fetchBinancePairs(): Promise<Pair[]> {
    const url = `${BINANCE_REST_API_URL}/exchangeInfo`;

    const res = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });
    if (!res.ok) throw new Error(`Failed to fetch markets Binance ${res.status}`);

    const json = (await res.json()) as {
      symbols?: Array<{
        status: string;
        baseAsset: string;
        quoteAsset: string;
        permissions?: string[];
        permissionSets?: string[][];
        isSpotTradingAllowed?: boolean;
      }>;
    };

    const symbols = json.symbols ?? [];

    return symbols
      .filter(
        (s) => String(s.status).toUpperCase() === 'TRADING' && s.isSpotTradingAllowed === true
      )
      .map((s) => {
        const base = s.baseAsset?.toUpperCase();
        const quote = s.quoteAsset?.toUpperCase();
        return base && quote ? { base, quote, display: `${base}/${quote}` } : null;
      })
      .filter((x): x is Pair => !!x);
  }

  /**
   * Fetches trading pairs from the Bybit exchange API.
   *
   * This method retrieves all available trading pairs from Bybit and transforms them
   * into standardized Pair objects with base, quote, and display properties.
   *
   * @private
   * @returns {Promise<Pair[]>} A promise that resolves to an array of standardized trading pairs
   * @throws {Error} If the API request fails or returns a non-200 status code
   */
  private async fetchBybitPairs(): Promise<Pair[]> {
    const baseUrl = `${BYBIT_REST_API_URL}/market/instruments-info?category=spot`;
    const pairs: Pair[] = [];

    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const url = cursor ? `${baseUrl}&cursor=${encodeURIComponent(cursor)}` : baseUrl;

      const res = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });
      if (!res.ok) throw new Error(`Failed to fetch markets Bybit ${res.status}`);

      const json = (await res.json()) as {
        retCode: number;
        retMsg: string;
        result?: {
          list?: Array<{ baseCoin: string; quoteCoin: string; status: string }>;
          nextPageCursor?: string;
        };
      };

      const list = json.result?.list ?? [];
      for (const i of list) {
        if (String(i.status).toLowerCase() !== 'trading') continue;
        const base = i.baseCoin?.toUpperCase();
        const quote = i.quoteCoin?.toUpperCase();
        if (base && quote) pairs.push({ base, quote, display: `${base}/${quote}` });
      }

      const next = json.result?.nextPageCursor;
      if (!next || next === cursor) break;
      cursor = next;
    }

    return pairs;
  }

  /**
   * Fetches trading pairs from the Coinbase exchange API.
   *
   * This method retrieves all available trading pairs from Coinbase,
   * filters for only those with 'online' status, and transforms them
   * into standardized Pair objects with base, quote, and display properties.
   *
   * @private
   * @returns {Promise<Pair[]>} A promise that resolves to an array of standardized trading pairs
   * @throws {Error} If the API request fails or returns a non-200 status code
   */
  private async fetchCoinbasePairs(): Promise<Pair[]> {
    const url = `${COINBASE_REST_API_URL}/products`;

    const res = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });
    if (!res.ok) throw new Error(`Failed to fetch markets Coinbase ${res.status}`);

    const products = (await res.json()) as Array<{
      id: string;
      base_currency: string;
      quote_currency: string;
      status: string;
      trading_disabled?: boolean;
      cancel_only?: boolean;
      post_only?: boolean;
      limit_only?: boolean;
    }>;

    return products
      .filter(
        (product) =>
          product.status === 'online' &&
          !product.trading_disabled &&
          !product.cancel_only &&
          !product.post_only &&
          !product.limit_only
      )
      .map((product) => {
        const base = product.base_currency?.toUpperCase();
        const quote = product.quote_currency?.toUpperCase();
        return base && quote ? { base, quote, display: `${base}/${quote}` } : null;
      })
      .filter((x): x is Pair => !!x);
  }

  /**
   * Fetches trading pairs from the OKX exchange API.
   *
   * This method retrieves all available trading pairs from OKX,
   * filters for only those with 'live' status, and transforms them
   * into standardized Pair objects with base, quote, and display properties.
   *
   * @private
   * @returns {Promise<Pair[]>} A promise that resolves to an array of standardized trading pairs
   * @throws {Error} If the API request fails or returns a non-200 status code
   */
  private async fetchOKXPairs(): Promise<Pair[]> {
    const url = `${OKX_REST_API_URL}/public/instruments?instType=SPOT`;

    const res = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });
    if (!res.ok) throw new Error(`Failed to fetch markets OKX ${res.status}`);

    const json = (await res.json()) as {
      code: string;
      msg: string;
      data: Array<{ instType: string; baseCcy: string; quoteCcy: string; state: string }>;
    };

    return (json.data ?? [])
      .filter(
        (i) =>
          String(i.instType).toUpperCase() === 'SPOT' && String(i.state).toLowerCase() === 'live'
      )
      .map((i) => {
        const base = i.baseCcy?.toUpperCase();
        const quote = i.quoteCcy?.toUpperCase();
        return base && quote ? { base, quote, display: `${base}/${quote}` } : null;
      })
      .filter((x): x is Pair => !!x);
  }

  /**
   * Fetch spot markets for an exchange and normalize to ticker pairs via ID→symbol map.
   *
   * @private
   * @param exchangeId The ID of the exchange to fetch markets from.
   * @param symbols A map of coin+fiat IDs to their symbols.
   * @returns A promise that resolves to an array of normalized ticker pairs.
   */
  private async fetchExchangePairs(
    exchangeId: string,
    symbols: Map<string, string>
  ): Promise<Pair[]> {
    const id = exchangeId.toLowerCase();

    const existing = INFLIGHT_BY_EXCHANGE.get(id);
    if (existing) return existing;

    const run = (async (): Promise<Pair[]> => {
      if (id === 'coinbase') return this.fetchCoinbasePairs();
      if (id === 'okx') return this.fetchOKXPairs();
      if (id === 'bybit') return this.fetchBybitPairs();
      if (id === 'binance') return this.fetchBinancePairs();

      const slug = PAPRIKA_SLUG[id] ?? id;
      const url = `https://api.coinpaprika.com/v1/exchanges/${slug}/markets`;

      const res = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });
      if (!res.ok) throw new Error(`Failed to fetch markets ${exchangeId} ${res.status}`);
      const data = (await res.json()) as ExchangeMarketResponse[];

      const pairs: Pair[] = [];
      for (const m of data) {
        const category = String(m?.category ?? '').toLowerCase();
        if (category && !['spot', 'fiat'].includes(category)) continue;

        const baseId = String(m?.base_currency_id ?? '');
        const quoteId = String(m?.quote_currency_id ?? '');
        let base = symbols.get(baseId);
        let quote = symbols.get(quoteId);

        if (!base || !quote) {
          const [pb, pq] = String(m?.pair ?? '').split('/');
          base = base || (pb ? pb.toUpperCase() : undefined);
          quote = quote || (pq ? pq.toUpperCase() : undefined);
        }

        if (base && quote) pairs.push({ base, quote, display: `${base}/${quote}` });
      }
      return pairs;
    })();

    INFLIGHT_BY_EXCHANGE.set(id, run);
    try {
      return await run;
    } finally {
      INFLIGHT_BY_EXCHANGE.delete(id);
    }
  }

  /**
   * Load fresh pairs from all exchanges (de-duplicated).
   *
   * @private
   * @returns A promise that resolves to an array of normalized ticker pairs.
   */
  private async loadFreshPairs(): Promise<Pair[]> {
    const symbols = await this.getSymbolsMap();
    const pairs = await Promise.allSettled(
      this.exchanges.map((id) => this.fetchExchangePairs(id, symbols))
    );

    const seen = new Set<string>();
    const res: Pair[] = [];

    for (const pair of pairs) {
      if (pair.status !== 'fulfilled') continue;

      for (const p of pair.value) {
        if (seen.has(p.display)) continue;
        seen.add(p.display);
        res.push(p);
      }
    }

    res.sort((a, b) => {
      const baseComparison = a.base.localeCompare(b.base);
      if (baseComparison !== 0) return baseComparison;
      return a.quote.localeCompare(b.quote);
    });

    return res;
  }

  /**
   * Search pairs.
   *
   * @param query The search query.
   * @param limit The maximum number of results to return.
   * @returns A promise that resolves to an array of matching pairs.
   */
  async search(query: string, limit = 200): Promise<Pair[]> {
    const all = await this.getPairs();
    const q = query.trim().toUpperCase();
    if (!q) return all.slice(0, limit);

    const res = all.filter(
      (p) => p.base.includes(q) || p.quote.includes(q) || p.display.includes(q)
    );
    return res.slice(0, limit);
  }

  /**
   * Get pairs with supported exchanges.
   *
   * @returns A promise that resolves to an array of pairs with their supported exchanges.
   */
  async getPairsWithExchanges(): Promise<PairWithExchanges[]> {
    const now = Date.now();
    if (this.cachePairsWithEx && isFresh(this.cacheWithExTs, this.cacheTtlMs))
      return this.cachePairsWithEx;

    const cached = readCacheEntryFromLocalStorage<PairWithExchanges[]>(
      this.getLocalStorageKeyPairsWithEx()
    );
    if (cached && isFresh(cached.ts, this.cacheTtlMs)) {
      this.cachePairsWithEx = cached.data;
      this.cacheWithExTs = cached.ts;
      return cached.data;
    }

    if (INFLIGHT_PAIRS_WITH_EX) return INFLIGHT_PAIRS_WITH_EX;

    INFLIGHT_PAIRS_WITH_EX = (async () => {
      const symbols = await this.getSymbolsMap();

      const results = await Promise.allSettled(
        this.exchanges.map((id) => this.fetchExchangePairs(id, symbols))
      );

      const pairsByDisplay = new Map<string, PairWithExchanges>();

      this.exchanges.forEach((exId, i) => {
        const res = results[i];
        if (res?.status !== 'fulfilled') return;
        for (const pair of res.value) {
          const key = pair.display;
          const existing = pairsByDisplay.get(key);
          if (existing) {
            if (!existing.exchanges.includes(exId)) existing.exchanges.push(exId);
          } else {
            pairsByDisplay.set(key, { ...pair, exchanges: [exId] });
          }
        }
      });

      const arr = Array.from(pairsByDisplay.values()).sort((a, b) => {
        const c = a.base.localeCompare(b.base);
        return c !== 0 ? c : a.quote.localeCompare(b.quote);
      });

      this.cachePairsWithEx = arr;
      this.cacheWithExTs = now;
      writeCacheEntryToLocalStorage(this.getLocalStorageKeyPairsWithEx(), arr);
      return arr;
    })();

    try {
      return await INFLIGHT_PAIRS_WITH_EX;
    } finally {
      INFLIGHT_PAIRS_WITH_EX = undefined;
    }
  }

  /**
   * Get exchanges that support a given pair.
   *
   * @param base The base currency.
   * @param quote The quote currency.
   * @returns A promise that resolves to an array of exchange IDs.
   */
  async exchangesForPair(base: string, quote: string): Promise<string[]> {
    const display = `${base}/${quote}`.toUpperCase();
    const list = await this.getPairsWithExchanges();
    const found = list.find((p) => p.display === display);
    return found?.exchanges ?? [];
  }

  /**
   * Check if an exchange supports a given trading pair.
   *
   * @param exchangeId The exchange ID.
   * @param base The base currency.
   * @param quote The quote currency.
   * @returns A promise that resolves to a boolean indicating support.
   */
  async supports(exchangeId: string, base: string, quote: string): Promise<boolean> {
    const exes = await this.exchangesForPair(base, quote);
    return exes.includes(exchangeId);
  }

  /**
   * Get pairs (cached with TTL). Set `force=true` to refresh.
   *
   * @param force Whether to bypass the cache and fetch fresh data.
   * @returns A promise that resolves to an array of pairs.
   */
  async getPairs(force = false): Promise<Pair[]> {
    if (!force && this.cachePairs && isFresh(this.cacheTs, this.cacheTtlMs)) return this.cachePairs;

    if (!force) {
      const cached = readCacheEntryFromLocalStorage<Pair[]>(this.getLocalStorageKeyPairs());
      if (cached && isFresh(cached.ts, this.cacheTtlMs)) {
        this.cachePairs = cached.data;
        this.cacheTs = cached.ts;
        return cached.data;
      }
    }

    if (this.pending) return this.pending;

    this.pending = this.loadFreshPairs()
      .then((pairs) => {
        this.cachePairs = pairs;
        this.cacheTs = Date.now();
        writeCacheEntryToLocalStorage(this.getLocalStorageKeyPairs(), pairs);
        this.pending = undefined;
        return pairs;
      })
      .catch((err) => {
        this.pending = undefined;
        throw err;
      });

    return this.pending;
  }

  /**
   * Clear caches.
   */
  clear() {
    this.cachePairs = null;
    this.cacheTs = 0;
    this.cachePairsWithEx = undefined;
    this.cacheWithExTs = 0;
    this.symbolsById = undefined;
    this.symbolsTs = 0;
    removeKeyFromLocalStorage(this.getLocalStorageKeyPairs());
    removeKeyFromLocalStorage(this.getLocalStorageKeyPairsWithEx());
  }
}
