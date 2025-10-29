import fees from './fees.v2025-08-26.json';
import { bucketizeOrderBook, parsePair, withHttpRetry } from '../../utils/utils';
import { calculateFeeRates } from '../../core/services/fee-rates';
import { CoinbaseBookClient } from './book-ws-client';
import { REST_API_URL } from './utils/constants';
import type { ExchangeAdapter } from '../../core/interfaces/exchange-adapter';
import type { OrderBook, OrderSide, OrderSizeAsset } from '../../core/interfaces/order-book';
import type { CostBreakdown, FeeData } from '../../core/interfaces/fee-config';
import type { CostCalculator } from '../../core/services/cost-calculator';
import type { CoinbaseBookRestResponse } from './book-ws-client';

export class CoinbaseAdapter implements ExchangeAdapter {
  readonly name = 'Coinbase';
  private bookWs: CoinbaseBookClient;
  private tickCache = new Map<string, number>();
  private currentPair?: string;
  priceBucket?: number;

  constructor(private costCalculator: CostCalculator) {
    this.bookWs = new CoinbaseBookClient();
  }

  /**
   * Fetches the order book for a given trading pair from the Coinbase API.
   *
   * @private
   * @param productId - The product ID (e.g., "BTC-USDT").
   * @returns A promise that resolves to the order book data.
   */
  private async fetchOrderBook(productId: string): Promise<OrderBook> {
    console.debug(`Fetching order book for ${productId} from Coinbase REST API...`);

    const url = `${REST_API_URL}/products/${encodeURIComponent(productId)}/book?level=2`;
    const response = await withHttpRetry(() => fetch(url), {
      maxAttempts: 5,
      baseDelayMs: 300,
    });

    if (!response.ok)
      throw new Error(
        `Failed to fetch Coinbase order book for ${productId}: HTTP ${response.status} ${response.statusText}`
      );

    const data = (await response.json()) as CoinbaseBookRestResponse;

    const bids = data.bids
      .map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) }))
      .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.quantity))
      .sort((a, b) => b.price - a.price);

    const asks = data.asks
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
   * @returns The trading pair (e.g., "BTC-USDT").
   */
  getPairSymbol(base: string, quote: string) {
    return `${base.toUpperCase()}-${quote.toUpperCase()}`;
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
   * @param productId - The product ID (e.g., "BTC-USDT").
   * @param priceBucket - The price bucket size for the order book.
   */
  async watchLivePair(productId: string, priceBucket?: number) {
    if (this.currentPair && this.currentPair !== productId)
      this.bookWs.unwatchPair(this.currentPair);

    if (this.currentPair === productId) return;

    this.currentPair = productId;
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
   * Retrieves the tick size (minimum price increment) for a given trading pair from Coinbase.
   *
   * The method first checks a local cache for the tick size. If not found or invalid,
   * it fetches the product details from the Coinbase API and extracts the tick size from
   * either `quote_increment` or `price_increment`. The result is cached for future calls.
   *
   * @param pair - The trading pair (e.g., "BTC-USD").
   * @returns A promise that resolves to the tick size as a number, or `undefined` if not available.
   */
  async getTickSize(pair: string): Promise<number | undefined> {
    const { base, quote } = parsePair(pair);
    const productId = this.getPairSymbol(base, quote);

    const cached = this.tickCache.get(productId);
    if (cached && cached > 0) return cached;

    const url = `${REST_API_URL}/products/${productId}`;
    const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!resp.ok) return undefined;

    const data = await resp.json();
    const tick = Number(data?.quote_increment ?? data?.price_increment);

    if (tick && isFinite(tick) && tick > 0) this.tickCache.set(productId, tick);

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
    const productId = this.getPairSymbol(base, quote);

    await this.watchLivePair(productId);

    let book = this.bookWs.getOrderBook(productId);
    if (!book) book = await this.fetchOrderBook(productId);

    if (!book.asks.length || !book.bids.length)
      throw new Error(`Empty Coinbase order book for ${pair}`);

    const exec = 'taker';
    const feeAsset = quote;

    const standardFeeRates = calculateFeeRates(fees as FeeData, {
      pair,
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
