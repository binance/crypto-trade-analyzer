import type { OrderBook } from './order-book';

export type OrderBookListener = (pairKey: string, book: OrderBook) => void;

export interface BookWsClient {
  connect(): Promise<void>;
  watchPair(pair: string, depthLimit?: number): Promise<void>;
  unwatchPair(pair: string): void;
  onUpdate(cb: OrderBookListener): () => void;
  getOrderBook(pair: string): OrderBook | undefined;
}
