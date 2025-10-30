export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

export type OrderSide = 'buy' | 'sell';

export type OrderSizeAsset = 'base' | 'quote';

export type OrderType = 'market';

export type RefPriceBasis = 'best-side' | 'mid';
