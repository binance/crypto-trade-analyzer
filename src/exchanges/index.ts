import { CostCalculator } from '../core/services/cost-calculator';
import { USDConverter } from '../core/services/usd-converter';

import { BinanceAdapter } from './binance/adapter';
import { OkxAdapter } from './okx/adapter';
import { BybitAdapter } from './bybit/adapter';
import { CoinbaseAdapter } from './coinbase/adapter';

import type { ExchangeAdapter } from '../core/interfaces/exchange-adapter';

// Shared services for all adapters
const usd = new USDConverter();
const calculator = new CostCalculator(usd);

// Instantiate adapters
const Binance = new BinanceAdapter(calculator);
const OKX = new OkxAdapter(calculator);
const Bybit = new BybitAdapter(calculator);
const Coinbase = new CoinbaseAdapter(calculator);

// Exchange registry
export const EXCHANGE_REGISTRY = {
  [Binance.name]: Binance,
  [OKX.name]: OKX,
  [Bybit.name]: Bybit,
  [Coinbase.name]: Coinbase,
} as const satisfies Record<string, ExchangeAdapter>;

// Exchange IDs
export type ExchangeId = keyof typeof EXCHANGE_REGISTRY;
