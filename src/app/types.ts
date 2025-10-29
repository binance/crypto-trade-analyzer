import type { ExchangeId } from '../exchanges';

export type PairMeta = {
  supportedBy: number;
  exchanges: ExchangeId[];
};

export interface PerExchangeSettings {
  userTier: string;
  tokenDiscount: boolean;
  customFees?: number;
}

export type FeeMeta = {
  userTiers: string[];
  defaultTier: string;
  supportsTokenDiscount: boolean;
};

export type TimeUnitStyle = 'full' | 'abbr' | 'short' | 'narrow';

export type OpenInfoKey =
  | 'Avg Price'
  | 'Fees'
  | 'Notional'
  | 'Receive'
  | 'Spend'
  | 'SaveVs'
  | 'Slippage'
  | null;
