import type { CostBreakdown, FeeData } from './fee-config';
import type { OrderBook, OrderSide, OrderSizeAsset } from './order-book';

export interface ExchangeAdapter {
  readonly name: string;
  getPairSymbol(base: string, quote: string): string;
  getFeeData(): FeeData;
  watchLivePair(productId: string, priceBucket?: number): Promise<void>;
  unwatchLivePair(): void;
  onLiveBook(cb: (pairKey: string, book: OrderBook) => void): () => void;
  getRawOrderBook(pairKey: string): OrderBook | undefined;
  setPriceBucket(tick: number | undefined): void;
  getTickSize: (pair: string) => Promise<number | undefined>;
  calculateCost({
    pair,
    orderSize,
    orderSizeAsset,
    orderSide,
    userTier,
    tokenDiscount,
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
  }): Promise<CostBreakdown>;
  disconnect(): void;
}
