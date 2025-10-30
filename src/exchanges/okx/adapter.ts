import fees from './fees.v2025-08-26.json';
import { bucketizeOrderBook, parsePair, withHttpRetry } from '../../utils/utils';
import { calculateFeeRates } from '../../core/services/fee-rates';
import { OkxBookClient } from './book-ws-client';
import { REST_API_URL } from './utils/constants';
import type { ExchangeAdapter } from '../../core/interfaces/exchange-adapter';
import type { OrderBook, OrderSide, OrderSizeAsset } from '../../core/interfaces/order-book';
import type { CostBreakdown, FeeData } from '../../core/interfaces/fee-config';
import type { CostCalculator } from '../../core/services/cost-calculator';
import type { OkxBookRestResponse } from './book-ws-client';

export class OkxAdapter implements ExchangeAdapter {
  readonly name = 'OKX';
  private bookWs: OkxBookClient;
  private tickCache = new Map<string, number>();
  private currentPair?: string;
  priceBucket?: number;

  constructor(private costCalculator: CostCalculator) {
    this.bookWs = new OkxBookClient();
  }

  /**
   * Fetches the order book for a given trading pair from the OKX API.
   *
   * @private
   * @param instId - The instrument ID (e.g., "BTC-USDT").
   * @param limit - The maximum number of order book entries to retrieve.
   * @returns A promise that resolves to the order book data.
   */
  private async fetchOrderBook(instId: string, limit = 5000): Promise<OrderBook> {
    console.debug(`Fetching order book for ${instId} from OKX REST API...`);

    const url = `${REST_API_URL}/market/books-full?instId=${encodeURIComponent(instId)}&sz=${limit}`;

    const response = await withHttpRetry(() => fetch(url), {
      maxAttempts: 5,
      baseDelayMs: 300,
    });
    if (!response.ok)
      throw new Error(
        `Failed to fetch OKX order book for ${instId}: HTTP ${response.status} ${response.statusText}`
      );

    const payload = (await response.json()) as OkxBookRestResponse;

    const first = payload.data?.[0];
    if (!first) throw new Error(`Empty OKX order book for ${instId} (REST)`);

    const bids = first.bids
      .map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) }))
      .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.quantity))
      .sort((a, b) => b.price - a.price);

    const asks = first.asks
      .map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) }))
      .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.quantity))
      .sort((a, b) => a.price - b.price);

    return bucketizeOrderBook({ bids, asks }, this.priceBucket!);
  }

  /**
   * Returns the trading pair for a given base and quote asset.
   *
   * @param base - The base asset (e.g., "BTC").
   * @param quote - The quote asset (e.g., "USDT").
   * @returns The trading symbol (e.g., "BTC-USDT").
   */
  getPairSymbol(base: string, quote: string) {
    return `${base}-${quote}`.toUpperCase();
  }

  /**
   * Returns the fee data for the exchange.
   *
   * @returns The fee data object.
   */
  getFeeData(): FeeData {
    return fees as FeeData;
  }

  /**
   * Ensures that the specified trading pair is being watched for updates.
   * If the pair is not currently watched, it will be added to the watch list.
   *
   * @param instId - The trading pair instrument ID (e.g., "BTC-USDT").
   * @param priceBucket - The price bucket size for the order book.
   */
  async watchLivePair(instId: string, priceBucket?: number) {
    if (this.currentPair && this.currentPair !== instId) this.bookWs.unwatchPair(this.currentPair);

    if (this.currentPair === instId) return;

    this.currentPair = instId;
    if (priceBucket && priceBucket > 0) {
      this.priceBucket = priceBucket;
      this.bookWs.priceBucket = priceBucket;
    }

    await this.bookWs.watchPair(this.currentPair);
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
   * Retrieves the tick size for a given trading pair from the OKX exchange.
   *
   * The method first checks an internal cache for the tick size. If not cached,
   * it fetches instrument details from the OKX public API, extracts the tick size,
   * and caches it for future requests. Returns `undefined` if the tick size cannot be determined.
   *
   * @param pair - The trading pair (e.g., "btc-usdt").
   * @returns A promise that resolves to the tick size as a number, or `undefined` if unavailable.
   */
  async getTickSize(pair: string): Promise<number | undefined> {
    const { base, quote } = parsePair(pair);
    const instId = this.getPairSymbol(base, quote);

    const cached = this.tickCache.get(instId);
    if (cached) return cached;

    const url = `${REST_API_URL}/public/instruments?instType=SPOT&instId=${instId}`;
    const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!resp.ok) return undefined;

    const data = await resp.json();
    const tick = Number(data?.data?.[0]?.tickSz);

    if (tick && isFinite(tick) && tick > 0) this.tickCache.set(instId, tick);

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
  }: {
    pair: string;
    orderSize: number;
    orderSizeAsset?: OrderSizeAsset;
    orderSide?: OrderSide;
    userTier?: string;
    tokenDiscount?: boolean;
    customFees?: number;
  }): Promise<CostBreakdown> {
    const { base, quote } = parsePair(pair);
    const instId = this.getPairSymbol(base, quote);

    await this.watchLivePair(instId);

    let book = this.bookWs.getOrderBook(instId);
    if (!book) book = await this.fetchOrderBook(instId);

    if (!book.asks.length || !book.bids.length)
      throw new Error(`Empty OKX order book for ${instId}`);

    const exec = 'taker';
    const feeAsset = orderSide === 'buy' ? base : quote;

    const standardFeeRates = calculateFeeRates(fees as FeeData, {
      pair: `${base}/${quote}`,
      exec,
      userTier,
      feeAsset,
      customFees,
    });

    return await this.costCalculator.calculateCost(
      this.name,
      book,
      orderSize,
      orderSide,
      standardFeeRates,
      base,
      quote,
      { feeAsset, sizeAsset: orderSizeAsset }
    );
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
