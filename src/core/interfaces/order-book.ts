export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  exchangeTs?: number;
  receiveTs?: number;
}

export type OrderSide = 'buy' | 'sell';

export type MarketType = 'spot' | 'futures';

export type OrderSizeAsset = 'base' | 'quote';

export type OrderType = 'market';

export type RefPriceBasis = 'best-side' | 'mid';

export type BookView = 'both' | 'bids' | 'asks';
