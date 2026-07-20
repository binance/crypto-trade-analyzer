import spotFees from './fees.v2025-08-26.json';
import futuresFees from './fees.futures.v2026-06-09.json';
import { attachFunding } from '../../core/services/funding-rate';
import { bucketizeOrderBook, parsePair, withHttpRetry } from '../../utils/utils';
import { calculateFeeRates } from '../../core/services/fee-rates';
import { BybitBookClient } from './book-ws-client';
import { REST_API_URL, FUTURES_SOCKET_URL, FUTURES_DEPTH_LIMIT } from './utils/constants';
import type { ExchangeAdapter } from '../../core/interfaces/exchange-adapter';
import type {
  MarketType,
  OrderBook,
  OrderSide,
  OrderSizeAsset,
} from '../../core/interfaces/order-book';
import type { CostBreakdown, FeeData } from '../../core/interfaces/fee-config';
import type { CostCalculator } from '../../core/services/cost-calculator';
import type { BybitBookRestResponse } from './book-ws-client';

export class BybitAdapter implements ExchangeAdapter {
  readonly name = 'Bybit';
  private bookWs: BybitBookClient;
  private tickCache = new Map<string, number>();
  private currentPair?: string;
  private fees: FeeData;
  private category: 'spot' | 'linear';
  private isFutures: boolean;
  priceBucket?: number;

  constructor(
    private costCalculator: CostCalculator,
    market: MarketType = 'spot'
  ) {
    this.isFutures = market === 'futures';
    this.fees = (this.isFutures ? futuresFees : spotFees) as FeeData;
    this.category = this.isFutures ? 'linear' : 'spot';
    this.bookWs = new BybitBookClient(
      this.isFutures
        ? { socketUrl: FUTURES_SOCKET_URL, category: 'linear', depthLimit: FUTURES_DEPTH_LIMIT }
        : {}
    );
  }

  /**
   * Fetches the order book for a given trading pair from the Bybit API.
   *
   * @private
   * @param symbol - The trading symbol (e.g., "BTCUSDT").
   * @param limit - The maximum number of order book entries to retrieve.
   * @returns A promise that resolves to the order book data.
   */
  private async fetchOrderBook(
    symbol: string,
    limit = this.isFutures ? FUTURES_DEPTH_LIMIT : 1000
  ): Promise<OrderBook> {
    console.debug(`Fetching order book for ${symbol} from Bybit REST API...`);

    const url = `${REST_API_URL}/market/orderbook?category=${this.category}&symbol=${encodeURIComponent(
      symbol
    )}&limit=${limit}`;
    const response = await withHttpRetry(() => fetch(url), {
      maxAttempts: 5,
      baseDelayMs: 300,
    });
    if (!response.ok)
      throw new Error(`Failed to fetch Bybit order book for ${symbol}: HTTP ${response.status}`);

    const payload = (await response.json()) as BybitBookRestResponse;

    const res = payload.result;
    if (!res) throw new Error(`Empty Bybit order book for ${symbol} (REST)`);

    const bids = res.b
      .map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) }))
      .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.quantity))
      .sort((a, b) => b.price - a.price);

    const asks = res.a
      .map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) }))
      .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.quantity))
      .sort((a, b) => a.price - b.price);

    return bucketizeOrderBook({ bids, asks }, this.priceBucket!);
  }

  /**
   * Returns the trading symbol for a given base and quote asset.
   *
   * @param base - The base asset (e.g., "BTC").
   * @param quote - The quote asset (e.g., "USDT").
   * @returns The trading symbol (e.g., "BTCUSDT").
   */
  getPairSymbol(base: string, quote: string) {
    if (this.isFutures && quote.toUpperCase() === 'USDC') return `${base.toUpperCase()}PERP`;
    return (base + quote).toUpperCase();
  }

  /**
   * Returns the fee data for the exchange.
   *
   * @returns The fee data object.
   */
  getFeeData(): FeeData {
    return this.fees;
  }

  /**
   * Ensures that the specified trading pair is being watched for updates.
   * If the pair is not currently watched, it will be added to the watch list.
   *
   * @param symbol - The trading pair (e.g., "BTCUSDT").
   * @param priceBucket - The price bucket size for the order book.
   */
  async watchLivePair(symbol: string, priceBucket?: number) {
    if (this.currentPair && this.currentPair !== symbol) this.bookWs.unwatchPair(this.currentPair);

    if (this.currentPair === symbol) return;

    this.currentPair = symbol;
    if (priceBucket && priceBucket > 0) {
      this.priceBucket = priceBucket;
      this.bookWs.priceBucket = priceBucket;
    }

    await this.bookWs.watchPair(symbol);
  }

  /**
   * Stops watching the current trading pair for live updates.
   * If a pair is currently being watched, it unsubscribes from its updates
   * and resets the `currentPair` property to `undefined`.
   */
  unwatchLivePair() {
    if (this.currentPair) this.bookWs.unwatchPair(this.currentPair);
    this.currentPair = undefined;
    this.priceBucket = undefined;
    this.bookWs.priceBucket = undefined;
  }

  /**
   * Subscribes to live updates of the order book for a specific trading pair.
   *
   * @param cb - The callback function to be called with updates.
   * @returns A function to unsubscribe from the updates.
   */
  onLiveBook(cb: (pairKey: string, book: OrderBook) => void): () => void {
    return this.bookWs.onUpdate(cb);
  }

  /**
   * Retrieves the raw order book for a given trading pair from the WebSocket client.
   *
   * @param pairKey - The trading pair key (e.g., "BTC-USDT").
   * @returns The raw order book for the specified trading pair, or undefined if not available.
   */
  getRawOrderBook(pairKey: string): OrderBook | undefined {
    return this.bookWs.getRawOrderBook(pairKey);
  }

  /**
   * Sets the price bucket size for the order book. This will affect how the order book data is aggregated and presented.
   *
   * @param tick - The price bucket size (tick size) to set. If `undefined`, the order book will not be bucketized.
   * @returns void
   */
  setPriceBucket(tick: number | undefined): void {
    this.priceBucket = tick;
    this.bookWs.priceBucket = tick;
  }

  /**
   * Retrieves the tick size for a given trading pair from Bybit's spot market API.
   *
   * The method first attempts to fetch the tick size from an internal cache.
   * If not cached, it requests instrument info from Bybit's public API, parses the tick size,
   * caches it for future use, and returns the value.
   *
   * @param pair - The trading pair in string format (e.g., "BTC-USDT").
   * @returns The tick size as a number if available and valid; otherwise, `undefined`.
   */
  async getTickSize(pair: string): Promise<number | undefined> {
    const { base, quote } = parsePair(pair);
    const symbol = this.getPairSymbol(base, quote);

    const cached = this.tickCache.get(symbol);
    if (cached) return cached;

    const url = `${REST_API_URL}/market/instruments-info?category=${this.category}&symbol=${symbol}`;
    const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!resp.ok) return undefined;

    const data = await resp.json();
    const dataRow = data?.result?.list?.[0];
    const tick = Number(dataRow?.priceFilter?.tickSize ?? dataRow?.priceFilter?.tick_size);

    if (tick && isFinite(tick) && tick > 0) this.tickCache.set(symbol, tick);

    return tick && isFinite(tick) && tick > 0 ? tick : undefined;
  }

  /**
   * Calculates the total cost for a given trading order
   *
   * @param params - The parameters for the order calculation.
   * @returns A promise that resolves to the cost breakdown for the order.
   */
  async calculateCost({
    pair,
    orderSize,
    orderSizeAsset,
    orderSide = 'buy',
    userTier,
    customFees,
    holdingPeriodHours,
  }: {
    pair: string;
    orderSize: number;
    orderSizeAsset?: OrderSizeAsset;
    orderSide?: OrderSide;
    userTier?: string;
    tokenDiscount?: boolean;
    customFees?: number;
    holdingPeriodHours?: number;
  }): Promise<CostBreakdown> {
    const { base, quote } = parsePair(pair);
    const symbol = this.getPairSymbol(base, quote);

    await this.watchLivePair(symbol);

    let book = this.bookWs.getOrderBook(symbol);
    if (!book || !book.asks.length || !book.bids.length) book = await this.fetchOrderBook(symbol);

    if (!book.asks.length || !book.bids.length)
      throw new Error(`Empty Bybit order book for ${symbol}`);

    const exec = 'taker';
    const feeAsset = orderSide === 'buy' ? base : quote;

    const standardFeeRates = calculateFeeRates(this.fees, {
      pair,
      exec,
      userTier,
      feeAsset,
      customFees,
    });

    const breakdown = await this.costCalculator.calculateCost(
      this.name,
      book,
      orderSize,
      orderSide,
      standardFeeRates,
      base,
      quote,
      { feeAsset, sizeAsset: orderSizeAsset }
    );

    if (this.isFutures)
      await attachFunding(breakdown, 'Bybit', symbol, orderSide, holdingPeriodHours);

    return breakdown;
  }

  /**
   * Disconnect from the WebSocket.
   *
   * @returns {void}
   */
  disconnect(): void {
    this.unwatchLivePair();
    this.bookWs.disconnect();
  }
}
