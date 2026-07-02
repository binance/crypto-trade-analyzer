import { CostCalculator } from '../core/services/cost-calculator';
import { USDConverter } from '../core/services/usd-converter';

import { BinanceAdapter } from './binance/adapter';
import { OkxAdapter } from './okx/adapter';
import { BybitAdapter } from './bybit/adapter';
import { CoinbaseAdapter } from './coinbase/adapter';

import type { ExchangeAdapter } from '../core/interfaces/exchange-adapter';
import type { MarketType } from '../core/interfaces/order-book';

// Shared services for all adapters
const usd = new USDConverter();
const calculator = new CostCalculator(usd);

// Spot adapters
const Binance = new BinanceAdapter(calculator, 'spot');
const OKX = new OkxAdapter(calculator, 'spot');
const Bybit = new BybitAdapter(calculator, 'spot');
const Coinbase = new CoinbaseAdapter(calculator);

const BinanceFutures = new BinanceAdapter(calculator, 'futures');
const OKXFutures = new OkxAdapter(calculator, 'futures');
const BybitFutures = new BybitAdapter(calculator, 'futures');

// Spot exchange registry
export const SPOT_REGISTRY = {
  [Binance.name]: Binance,
  [OKX.name]: OKX,
  [Bybit.name]: Bybit,
  [Coinbase.name]: Coinbase,
} as const satisfies Record<string, ExchangeAdapter>;

// Perpetuals registry
export const FUTURES_REGISTRY = {
  [BinanceFutures.name]: BinanceFutures,
  [OKXFutures.name]: OKXFutures,
  [BybitFutures.name]: BybitFutures,
} as const satisfies Partial<Record<keyof typeof SPOT_REGISTRY, ExchangeAdapter>>;

// Exchange IDs
export type ExchangeId = keyof typeof SPOT_REGISTRY;

/**
 * Returns the adapter registry for the given market. The perpetuals registry omits Coinbase,
 * so callers should derive their exchange-id list from the returned object's keys.
 */
export function getRegistry(market: MarketType): Partial<Record<ExchangeId, ExchangeAdapter>> {
  return market === 'futures' ? FUTURES_REGISTRY : SPOT_REGISTRY;
}
