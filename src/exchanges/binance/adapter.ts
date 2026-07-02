import spotFees from './fees.v2025-08-22.json';
import futuresFees from './fees.futures.v2026-06-09.json';
import { attachFunding } from '../../core/services/funding-rate';
import { bucketizeOrderBook, parsePair, withHttpRetry } from '../../utils/utils';
import { calculateFeeRates } from '../../core/services/fee-rates';
import { BinanceBookClient } from './book-ws-client';
import {
  FUTURES_REST_API_URL,
  FUTURES_SOCKET_URL,
  FUTURES_DEPTH_LIMIT,
  REST_API_URL,
} from './utils/constants';
import type { ExchangeAdapter } from '../../core/interfaces/exchange-adapter';
import type {
  MarketType,
  OrderBook,
  OrderSide,
  OrderSizeAsset,
} from '../../core/interfaces/order-book';
import type { CostBreakdown, FeeData } from '../../core/interfaces/fee-config';
import type { CostCalculator } from '../../core/services/cost-calculator';
import type { BinanceDepthRestResponse } from './book-ws-client';

export class BinanceAdapter implements ExchangeAdapter {
  readonly name = 'Binance';
  private bookWs: BinanceBookClient;
  private tickCache = new Map<string, number>();
  private currentPair?: string;
  private fees: FeeData;
  private restApiUrl: string;

  priceBucket?: number;

  constructor(
    private costCalculator: CostCalculator,
    private market: MarketType = 'spot'
  ) {
    const isFutures = market === 'futures';
    this.fees = (isFutures ? futuresFees : spotFees) as FeeData;
    this.restApiUrl = isFutures ? FUTURES_REST_API_URL : REST_API_URL;
    this.bookWs = new BinanceBookClient(
      isFutures
        ? {
            market: 'futures',
            socketUrl: FUTURES_SOCKET_URL,
            restUrl: FUTURES_REST_API_URL,
            depthLimit: FUTURES_DEPTH_LIMIT,
          }
        : {}
    );
  }

  /**
   * Fetches the order book for a given trading pair from the Binance API.
   *
   * @private
   * @param symbol - The trading symbol (e.g., "BTCUSDT").
   * @param limit - The maximum number of order book entries to retrieve.
   * @returns A promise that resolves to the order book data.
   */
  private async fetchOrderBook(
    symbol: string,
    limit = this.market === 'spot' ? 5000 : FUTURES_DEPTH_LIMIT
  ): Promise<OrderBook> {
    console.debug(`Fetching order book for ${symbol} from Binance REST API...`);

    const url = `${this.restApiUrl}/depth?symbol=${symbol}&limit=${limit}`;
    const response = await withHttpRetry(() => fetch(url), {
      maxAttempts: 5,
      baseDelayMs: 300,
    });

    if (!response.ok)
      throw new Error(
        `Failed to fetch Binance order book for ${symbol}: HTTP ${response.status} ${response.statusText}`
      );

    const data = (await response.json()) as BinanceDepthRestResponse;

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
   * @returns The trading symbol (e.g., "BTCUSDT").
   */
  getPairSymbol(base: string, quote: string) {
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
   * @param symbol - The trading symbol (e.g., "BTCUSDT").
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
   * Retrieves the tick size for a given trading pair from Binance.
   *
   * The tick size represents the minimum price movement for the specified pair.
   * This method first checks an internal cache for the tick size. If not found,
   * it fetches exchange information from Binance's public API, extracts the tick size
   * from the PRICE_FILTER, and caches the result for future calls.
   *
   * @param pair - The trading pair in string format (e.g., "BTCUSDT").
   * @returns A promise that resolves to the tick size as a number, or `undefined` if not available.
   */
  async getTickSize(pair: string): Promise<number | undefined> {
    const { base, quote } = parsePair(pair);
    const symbol = this.getPairSymbol(base, quote);

    const cached = this.tickCache.get(symbol);
    if (cached) return cached;

    const url = `${this.restApiUrl}/exchangeInfo?symbol=${symbol}`;
    const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!resp.ok) return undefined;

    const data = await resp.json();
    const sym = data?.symbols?.[0];
    const priceFilter = sym?.filters?.find(
      (f: { filterType: string; tickSize?: string }) => f.filterType === 'PRICE_FILTER'
    );
    const tick = Number(priceFilter?.tickSize);
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
    tokenDiscount = false,
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
    if (!book) book = await this.fetchOrderBook(symbol);

    if (!book.asks.length || !book.bids.length)
      throw new Error(`Empty Binance order book for ${pair}`);

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
      {
        feeAsset,
        sizeAsset: orderSizeAsset,
        ...(!customFees &&
          tokenDiscount && {
            feeScenario: {
              feeAsset: 'BNB',
              feeRates: calculateFeeRates(this.fees, {
                pair,
                exec,
                userTier,
                feeAsset: 'BNB',
                customFees,
              }),
            },
          }),
      }
    );

    if (this.market === 'futures')
      await attachFunding(breakdown, 'Binance', symbol, orderSide, holdingPeriodHours);

    return breakdown;
  }

  /**
   * Disconnect from the WebSocket.
   *
   * @returns {Promise<void>}
   */
  async disconnect(): Promise<void> {
    this.unwatchLivePair();
    this.bookWs.disconnect();
  }
}
