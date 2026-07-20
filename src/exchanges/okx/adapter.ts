import spotFees from './fees.v2025-08-26.json';
import futuresFees from './fees.futures.v2026-06-09.json';
import { attachFunding } from '../../core/services/funding-rate';
import { bucketizeOrderBook, parsePair, withHttpRetry } from '../../utils/utils';
import { calculateFeeRates } from '../../core/services/fee-rates';
import { OkxBookClient } from './book-ws-client';
import { REST_API_URL } from './utils/constants';
import type { ExchangeAdapter } from '../../core/interfaces/exchange-adapter';
import type {
  MarketType,
  OrderBook,
  OrderSide,
  OrderSizeAsset,
} from '../../core/interfaces/order-book';
import type { CostBreakdown, FeeData } from '../../core/interfaces/fee-config';
import type { CostCalculator } from '../../core/services/cost-calculator';
import type { OkxBookRestResponse } from './book-ws-client';

export class OkxAdapter implements ExchangeAdapter {
  readonly name = 'OKX';
  private bookWs: OkxBookClient;
  private tickCache = new Map<string, number>();
  private ctValCache = new Map<string, number>();
  private currentPair?: string;
  private fees: FeeData;
  private instType: 'SPOT' | 'SWAP';
  priceBucket?: number;

  constructor(
    private costCalculator: CostCalculator,
    private market: MarketType = 'spot'
  ) {
    const isFutures = market === 'futures';
    this.fees = (isFutures ? futuresFees : spotFees) as FeeData;
    this.instType = isFutures ? 'SWAP' : 'SPOT';
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
    const instId = `${base}-${quote}`.toUpperCase();
    return this.market === 'futures' ? `${instId}-SWAP` : instId;
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
    if (this.instType !== 'SWAP') return this.bookWs.onUpdate(cb);
    return this.bookWs.onUpdate((pairKey: string, book: OrderBook) => {
      const ctVal = this.ctValCache.get(pairKey) ?? 1;
      cb(pairKey, this.scaleBookByContractValue(book, ctVal));
    });
  }

  /**
   * Retrieves the raw order book for a given trading pair from the WebSocket client.
   *
   * @param pairKey - The trading pair key (e.g., "BTC-USDT").
   * @returns The raw order book for the specified trading pair, or undefined if not available.
   */
  getRawOrderBook(pairKey: string): OrderBook | undefined {
    const raw = this.bookWs.getRawOrderBook(pairKey);
    if (!raw) return undefined;
    if (this.instType === 'SWAP') {
      const ctVal = this.ctValCache.get(pairKey) ?? 1;
      return this.scaleBookByContractValue(raw, ctVal);
    }
    return raw;
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

    const url = `${REST_API_URL}/public/instruments?instType=${this.instType}&instId=${instId}`;
    const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!resp.ok) return undefined;

    const data = await resp.json();
    const row = data?.data?.[0];
    const tick = Number(row?.tickSz);

    if (tick && isFinite(tick) && tick > 0) this.tickCache.set(instId, tick);

    if (this.instType === 'SWAP') {
      const ctVal = Number(row?.ctVal);
      if (ctVal && isFinite(ctVal) && ctVal > 0) this.ctValCache.set(instId, ctVal);
    }

    return tick && isFinite(tick) && tick > 0 ? tick : undefined;
  }

  /**
   * Returns base units per contract for a SWAP instId (1 for spot). Fetches and caches
   * ctVal from /public/instruments on a miss.
   *
   * @param instId - The instrument id (e.g. "BTC-USDT-SWAP").
   */
  private async getContractValue(instId: string): Promise<number> {
    if (this.instType !== 'SWAP') return 1;

    const cached = this.ctValCache.get(instId);
    if (cached && cached > 0) return cached;

    const url = `${REST_API_URL}/public/instruments?instType=SWAP&instId=${instId}`;
    const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!resp.ok) return 1;

    const data = await resp.json();
    const ctVal = Number(data?.data?.[0]?.ctVal);
    if (ctVal && isFinite(ctVal) && ctVal > 0) {
      this.ctValCache.set(instId, ctVal);
      return ctVal;
    }
    return 1;
  }

  /**
   * Scales an order book's quantities from contracts to base units for SWAP (no-op for spot
   * or ctVal=1). OKX returns depth sizes in contracts; the cost calculator expects base units.
   *
   * @param book - The order book whose quantities are in contracts.
   * @param ctVal - Base units per contract.
   */
  private scaleBookByContractValue(book: OrderBook, ctVal: number): OrderBook {
    if (ctVal === 1) return book;
    const scale = (e: { price: number; quantity: number }) => ({
      price: e.price,
      quantity: e.quantity * ctVal,
    });
    return {
      bids: book.bids.map(scale),
      asks: book.asks.map(scale),
      exchangeTs: book.exchangeTs,
      receiveTs: book.receiveTs,
    };
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
    const instId = this.getPairSymbol(base, quote);

    await this.watchLivePair(instId);

    let book = this.bookWs.getOrderBook(instId);
    if (!book) book = await this.fetchOrderBook(instId);

    if (!book.asks.length || !book.bids.length)
      throw new Error(`Empty OKX order book for ${instId}`);

    if (this.instType === 'SWAP') {
      const ctVal = await this.getContractValue(instId);
      book = this.scaleBookByContractValue(book, ctVal);
    }

    const exec = 'taker';
    const feeAsset = orderSide === 'buy' ? base : quote;

    const standardFeeRates = calculateFeeRates(this.fees, {
      pair: `${base}/${quote}`,
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

    if (this.market === 'futures')
      await attachFunding(breakdown, 'OKX', instId, orderSide, holdingPeriodHours);

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
