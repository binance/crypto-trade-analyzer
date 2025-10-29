import type { OrderSide } from './order-book';

export type TierRates = {
  maker: number;
  taker: number;
};

export type Schedule = {
  name: string;
  defaultTier: string;
  tiers: Record<string, TierRates>;
};

export type Match = {
  quoteAssets?: string[];
  baseAssets?: string[];
  pairs?: string[];
  pairsRegex?: string;
  exec?: string[];
  tiers?: string[];
};

export type FeeRateType =
  | 'default'
  | 'custom'
  | 'override'
  | 'override_per_tier'
  | 'add'
  | 'multiply'
  | 'token_discount';

export type Effect = {
  mode: FeeRateType;
  maker?: number;
  taker?: number;
  perTier?: Record<string, Partial<TierRates>>;
};

export type Modifier = {
  id: string;
  match?: Match;
  effect: Effect;
  stacking?: {
    withDiscounts?: boolean;
    withOtherModifiers?: boolean;
    exclusive?: boolean;
  };
  notes?: string[];
};

export type Discount = {
  id: string;
  label: string;
  type: string;
  value: number;
  appliesTo: string[];
  requires?: {
    feeAsset?: string;
  };
  order: string;
};

export type FeeData = {
  exchange: string;
  version: string;
  userTiers: string[];
  supportsTokenDiscount: boolean;
  schedule: Schedule;
  modifiers?: Modifier[];
  tokenDiscount?: Discount;
};

export type FeeRateResult = {
  base: {
    maker: number;
    taker: number;
    tier: string;
    schedule: string;
  };
  final: {
    maker: number;
    taker: number;
  };
  feeRateAnalysis: FeeRateAnalysis[];
};

export interface CostItem {
  amount: number;
  asset: string;
  usd: number;
  rate?: number;
  amountInBase?: number;
  amountInQuote?: number;
}

export interface FeeRateAnalysis {
  id: string;
  rate: number;
  type?: FeeRateType;
}

export interface CostBreakdown {
  exchange: string;
  baseAsset: string;
  quoteAsset: string;
  sizeAsset: string;
  side: OrderSide;
  sizeBase: number;
  averagePrice: number;
  averagePriceUsd: number;
  referencePrice: number;
  usdPerBase: number;
  usdPerQuote: number;
  feeRateAnalysis: FeeRateAnalysis[];
  execution: CostItem;
  tradingFee: CostItem;
  slippage: CostItem;
  netBaseReceived: number;
  netQuoteReceived: number;
  totalQuote: number;
  totalBase: number;
  totalReceivedUsd: number;
  totalSpentUsd: number;
  totalTradeUsd: number;
}

export type FeeScenarioInput = {
  feeAsset: string;
  feeRates: FeeRateResult;
};
