import type { CostBreakdown, FeeData } from './fee-config';
import type { OrderBook, OrderSide } from './order-book';

export interface ExchangeAdapter {
  readonly name: string;
  getPairSymbol(base: string, quote: string): string;
  getFeeData(): FeeData;
  watchLivePair(productId: string, priceBucket?: number): Promise<void>;
  unwatchLivePair(): void;
  onLiveBook(cb: (pairKey: string, book: OrderBook) => void): () => void;
  getTickSize: (pair: string) => Promise<number | undefined>;
  calculateCost({
    pair,
    orderSize,
    orderSide,
    userTier,
    tokenDiscount,
  }: {
    pair: string;
    orderSize: number;
    orderSide?: OrderSide;
    userTier?: string;
    tokenDiscount?: boolean;
  }): Promise<CostBreakdown>;
  disconnect(): void;
}
