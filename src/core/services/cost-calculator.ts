import { Decimal } from '../../utils/decimal';
import type {
  OrderBook,
  OrderBookEntry,
  OrderSide,
  OrderSizeAsset,
  RefPriceBasis,
} from '../interfaces/order-book';
import type {
  CostBreakdown,
  CostItem,
  FeeScenarioInput,
  FeeRateResult,
} from '../interfaces/fee-config';
import type { USDConverter } from './usd-converter';

export class CostCalculator {
  constructor(private usdConverter: USDConverter) {}

  /**
   * Calculates the total quote cost and average price for a given base asset size,
   * based on the provided order book entries. Iterates through the order book to
   * accumulate the cost until the requested base size is fulfilled or liquidity runs out.
   *
   * @param orderBookEntries - Array of order book entries, each containing a price and quantity.
   * @param side - The side of the order ('buy' or 'sell').
   * @param sizeBase - The desired amount of base asset to purchase (as a Decimal).
   * @param sizeAsset - Indicates whether the size is specified in 'base' or 'quote' asset units.
   * @param baseAsset - The base asset of the trading pair.
   * @param quoteAsset - The quote asset of the trading pair.
   * @returns An object containing:
   *   - `quoteCost`: The total cost in quote currency (as a Decimal).
   *   - `avgPrice`: The average price paid per unit of base asset (as a Decimal).
   * @throws Error if there is insufficient liquidity to fulfill the requested base size.
   */
  private calculateQuoteCost(
    orderBookEntries: OrderBookEntry[],
    side: OrderSide,
    sizeBase: Decimal,
    sizeAsset: OrderSizeAsset,
    baseAsset: string,
    quoteAsset: string
  ): { quoteCost: Decimal; avgPrice: Decimal } {
    let remaining = sizeBase;
    let quoteCost = new Decimal(0);
    let lastLevelPrice: Decimal | undefined;

    for (const { price, quantity } of orderBookEntries) {
      const priceDecimal = new Decimal(price);
      const quantityDecimal = new Decimal(quantity);
      const takeBase = Decimal.min(remaining, quantityDecimal);

      quoteCost = quoteCost.add(takeBase.mul(priceDecimal));
      remaining = remaining.sub(takeBase);
      lastLevelPrice = priceDecimal;

      if (remaining.lte(0)) break;
    }

    if (remaining.gt(0)) {
      const available = sizeBase.sub(remaining);
      const msg =
        `Insufficient liquidity | side=${side} |` +
        `requested=${sizeBase.toFixed(8)} | available=${available.toFixed(8)} | ` +
        `levels=${orderBookEntries.length} | sizeAsset=${sizeAsset === 'base' ? baseAsset : quoteAsset} |` +
        (lastLevelPrice ? `last=${lastLevelPrice.toFixed(12)} | ` : '');
      throw new Error(msg);
    }

    return { quoteCost, avgPrice: quoteCost.div(sizeBase) };
  }

  /**
   * Calculates the total base amount and average price required to fulfill a target quote amount
   * using the provided order book entries.
   *
   * Iterates through the order book entries, consuming available liquidity at each price level
   * until the quote target is met or liquidity is exhausted. Throws an error if there is
   * insufficient liquidity to fulfill the quote target.
   *
   * @param orderBookEntries - Array of order book entries, each containing a price and quantity (base units).
   * @param side - The side of the order ('buy' or 'sell').
   * @param quoteTarget - The target quote amount to be fulfilled.
   * @param sizeAsset - Indicates whether the size is specified in 'base' or 'quote' asset units.
   * @param baseAsset - The base asset of the trading pair.
   * @param quoteAsset - The quote asset of the trading pair.
   * @returns An object containing:
   *   - baseAmount: The total base amount required to fulfill the quote target.
   *   - avgPrice: The average price paid for the base amount.
   * @throws Error if the available liquidity is insufficient to fulfill the quote target.
   */
  private calculateBaseForQuoteTarget(
    orderBookEntries: OrderBookEntry[],
    side: OrderSide,
    quoteTarget: Decimal,
    sizeAsset: OrderSizeAsset,
    baseAsset: string,
    quoteAsset: string
  ): { baseAmount: Decimal; avgPrice: Decimal } {
    let remainingQuote = quoteTarget;
    let baseTotal = new Decimal(0);
    let lastLevelPrice: Decimal | undefined;

    for (const { price, quantity } of orderBookEntries) {
      const priceDecimal = new Decimal(price);
      const quantityDecimal = new Decimal(quantity);
      if (priceDecimal.lte(0) || quantityDecimal.lte(0)) continue;

      const levelQuoteCapacity = quantityDecimal.mul(priceDecimal);
      const takeQuote = Decimal.min(remainingQuote, levelQuoteCapacity);
      if (takeQuote.lte(0)) continue;

      const takeBase = takeQuote.div(priceDecimal);
      baseTotal = baseTotal.add(takeBase);
      remainingQuote = remainingQuote.sub(takeQuote);
      lastLevelPrice = priceDecimal;

      if (remainingQuote.lte(0)) break;
    }

    if (remainingQuote.gt(0)) {
      const availableQuote = quoteTarget.sub(remainingQuote);
      const msg =
        `Insufficient liquidity | side=${side} |` +
        `requested=${quoteTarget.toFixed(8)} | available=${availableQuote.toFixed(8)} | ` +
        `levels=${orderBookEntries.length} | sizeAsset=${sizeAsset === 'base' ? baseAsset : quoteAsset} |` +
        (lastLevelPrice ? `last=${lastLevelPrice.toFixed(12)} | ` : '');
      throw new Error(msg);
    }

    const avgPrice = baseTotal.gt(0) ? quoteTarget.div(baseTotal) : new Decimal(0);
    return { baseAmount: baseTotal, avgPrice };
  }

  /**
   * Calculates the reference price from the order book based on the specified side and reference basis.
   *
   * @private
   * @param side - The side of the order ('buy' or 'sell').
   * @param book - The order book containing bids and asks.
   * @param basis - The reference basis to use ('mid' for midpoint, otherwise uses best ask for buy or best bid for sell).
   * @returns The calculated reference price as a Decimal.
   */
  private getReferencePrice(side: OrderSide, book: OrderBook, basis: RefPriceBasis): Decimal {
    if (basis === 'mid') {
      const bestBid = new Decimal(book.bids[0].price);
      const bestAsk = new Decimal(book.asks[0].price);
      return bestBid.add(bestAsk).div(2);
    }
    return new Decimal(side === 'buy' ? book.asks[0].price : book.bids[0].price);
  }

  /**
   * Calculates the slippage for a trade based on the order side, reference price, and average price.
   *
   * Slippage is the difference between the expected price (referencePrice) and the actual average price (avgPrice)
   * at which the trade is executed. For 'buy' orders, slippage is positive if avgPrice > referencePrice.
   * For 'sell' orders, slippage is positive if referencePrice > avgPrice.
   *
   * If the calculated slippage is negative, it is set to zero.
   *
   * @param side - The side of the order ('buy' or 'sell').
   * @param referencePrice - The expected price before executing the trade.
   * @param avgPrice - The average price at which the trade was executed.
   * @returns An object containing:
   *   - referencePrice: The original reference price.
   *   - slippageQuotePerUnit: The absolute slippage per unit.
   *   - slippageRate: The slippage as a rate (relative to referencePrice).
   */
  private calculateSlippage(
    side: OrderSide,
    referencePrice: Decimal,
    avgPrice: Decimal
  ): { referencePrice: Decimal; slippageQuotePerUnit: Decimal; slippageRate: Decimal } {
    let rawDelta = side === 'buy' ? avgPrice.sub(referencePrice) : referencePrice.sub(avgPrice);

    if (rawDelta.lt(0)) rawDelta = new Decimal(0);

    const slippageRate = referencePrice.gt(0) ? rawDelta.div(referencePrice) : new Decimal(0);

    return {
      referencePrice,
      slippageQuotePerUnit: rawDelta,
      slippageRate,
    };
  }

  /**
   * Builds a fee item representing the cost of a transaction fee in terms of the specified asset.
   *
   * The fee can be denominated in the quote asset, base asset, or a third asset. The method calculates
   * the fee amount and its USD equivalent based on the provided parameters and the asset type.
   *
   * @private
   * @param feeAsset - The asset in which the fee is charged.
   * @param baseAsset - The base asset of the trading pair.
   * @param quoteAsset - The quote asset of the trading pair.
   * @param feeRate - The fee rate as a Decimal.
   * @param sizeBaseExecuted - The size of the base asset involved in the transaction.
   * @param quoteCost - The total cost in quote asset for the transaction.
   * @param usdPerBase - The USD price per unit of the base asset.
   * @param usdPerQuote - The USD price per unit of the quote asset.
   * @returns A promise that resolves to a {@link CostItem} containing the fee amount, asset, USD value, and rate.
   */
  private async buildFeeItem(
    feeAsset: string,
    baseAsset: string,
    quoteAsset: string,
    feeRate: Decimal,
    sizeBaseExecuted: Decimal,
    quoteCost: Decimal,
    usdPerBase: Decimal,
    usdPerQuote: Decimal
  ): Promise<CostItem> {
    if (feeAsset.toUpperCase() === baseAsset.toUpperCase()) {
      const amount = sizeBaseExecuted.mul(feeRate);
      return {
        amount: amount.toNumber(),
        asset: baseAsset,
        usd: amount.mul(usdPerBase).toNumber(),
        rate: feeRate.toNumber(),
      };
    }

    if (feeAsset.toUpperCase() === quoteAsset.toUpperCase()) {
      const amount = quoteCost.mul(feeRate);
      return {
        amount: amount.toNumber(),
        asset: quoteAsset,
        usd: amount.mul(usdPerQuote).toNumber(),
        rate: feeRate.toNumber(),
      };
    }

    // Fee in third asset (not base or quote)
    const executionUSD = quoteCost.mul(usdPerQuote);
    const feeUsd = executionUSD.mul(feeRate);
    const usdPerThird = await this.usdConverter.convert(feeAsset, new Decimal(1));
    const amount = usdPerThird.gt(0) ? feeUsd.div(usdPerThird) : new Decimal(0);

    return {
      amount: amount.toNumber(),
      asset: feeAsset,
      usd: feeUsd.toNumber(),
      rate: feeRate.toNumber(),
    };
  }

  /**
   * Calculates the cost breakdown for executing a trade of a given size and side on an order book,
   * including execution cost, slippage, trading fees, and USD conversions.
   *
   * @param book - The order book containing asks and bids.
   * @param size - The trade size, expressed in base or quote asset units.
   * @param side - The side of the order ('buy' or 'sell').
   * @param feeRates - The fee rates applicable to the trade.
   * @param baseAsset - The symbol of the base asset.
   * @param quoteAsset - The symbol of the quote asset.
   * @param opts - Optional parameters for cost calculation.
   * @param opts.feeAsset - The asset in which the fee is charged.
   * @param opts.referenceBasis - The basis for reference price calculation.
   * @param opts.feeScenario - Custom fee scenario input.
   * @param opts.sizeAsset - Specifies whether the size is in base or quote asset units.
   * @returns A promise that resolves to a {@link CostBreakdown} object containing detailed cost information.
   * @throws Error if the size is not positive or the order book is empty.
   */
  async calculateCost(
    exchangeName: string,
    book: OrderBook,
    size: number | string | Decimal,
    side: OrderSide,
    feeRates: FeeRateResult,
    baseAsset: string,
    quoteAsset: string,
    opts: {
      feeAsset?: string;
      referenceBasis?: RefPriceBasis;
      feeScenario?: FeeScenarioInput;
      sizeAsset?: OrderSizeAsset;
    } = {}
  ): Promise<CostBreakdown> {
    const sizeDecimal = new Decimal(size);
    if (sizeDecimal.lte(0)) throw new Error('Size must be positive');
    if (!book.asks?.length || !book.bids?.length) throw new Error('Empty order book');

    const basis = opts.referenceBasis ?? 'best-side';
    const sizeAsset: OrderSizeAsset = opts.sizeAsset ?? 'base';

    let executedQuote: Decimal; // quote notional before fees
    let executedBase: Decimal; // base amount before fees
    let avgPrice: Decimal; // quote per base

    // Calculate executed amounts based on size asset
    if (sizeAsset === 'base') {
      const { quoteCost, avgPrice: avg } = this.calculateQuoteCost(
        side === 'buy' ? book.asks : book.bids,
        side,
        sizeDecimal,
        sizeAsset,
        baseAsset,
        quoteAsset
      );
      executedQuote = quoteCost;
      executedBase = sizeDecimal;
      avgPrice = avg;
    } else {
      const { baseAmount, avgPrice: avg } = this.calculateBaseForQuoteTarget(
        side === 'buy' ? book.asks : book.bids,
        side,
        sizeDecimal,
        sizeAsset,
        baseAsset,
        quoteAsset
      );
      executedQuote = sizeDecimal;
      executedBase = baseAmount;
      avgPrice = avg;
    }

    // Determine reference price based on basis
    const referencePrice = this.getReferencePrice(side, book, basis);

    // Calculate slippage
    const { slippageQuotePerUnit, slippageRate } = this.calculateSlippage(
      side,
      referencePrice,
      avgPrice
    );

    // Calculate slippage in quote terms
    const slippageQuote = slippageQuotePerUnit.mul(executedBase);

    // USD conversions
    const usdPerQuote = await this.usdConverter.convert(quoteAsset, new Decimal(1));
    const usdPerBase = usdPerQuote.mul(avgPrice);

    // Execution, average price and slippage in USD
    const executionUSD = usdPerQuote.mul(executedQuote);
    const slippageUSD = usdPerQuote.mul(slippageQuote);
    const avgPriceUsd = avgPrice.mul(usdPerQuote);

    // Build cost items
    const executionItem: CostItem = {
      amount: executedQuote.toNumber(),
      asset: quoteAsset,
      usd: executionUSD.toNumber(),
    };
    const slippageItem: CostItem = {
      amount: slippageQuote.toNumber(),
      amountInBase: (avgPrice.gt(0) ? slippageQuote.div(avgPrice) : new Decimal(0)).toNumber(),
      asset: quoteAsset,
      usd: slippageUSD.toNumber(),
      rate: slippageRate.toNumber(),
    };

    // Determine fee scenario
    const scenario: FeeScenarioInput = opts.feeScenario ?? {
      feeAsset: opts.feeAsset ?? (side === 'buy' ? baseAsset : quoteAsset),
      feeRates,
    };

    // Calculate trading fee
    const effRateNum = scenario.feeRates.final?.taker ?? scenario.feeRates.base.taker;
    const feeRate = new Decimal(effRateNum);

    // Trading fee item (use executed base + quote)
    const feeItem = await this.buildFeeItem(
      scenario.feeAsset,
      baseAsset,
      quoteAsset,
      feeRate,
      executedBase,
      executedQuote,
      usdPerBase,
      usdPerQuote
    );

    // Augment fee item with amounts in base/quote
    const feeUSD = new Decimal(feeItem.usd);
    const feeAmt = new Decimal(feeItem.amount);
    const isBase = feeItem.asset.toUpperCase() === baseAsset.toUpperCase();
    const isQuote = feeItem.asset.toUpperCase() === quoteAsset.toUpperCase();

    const feeAmountInBase = isBase
      ? feeAmt
      : isQuote
        ? avgPrice.gt(0)
          ? feeAmt.div(avgPrice)
          : new Decimal(0)
        : usdPerBase.gt(0)
          ? feeUSD.div(usdPerBase)
          : new Decimal(0);

    const feeAmountInQuote = isQuote
      ? feeAmt
      : isBase
        ? avgPrice.gt(0)
          ? feeAmt.mul(avgPrice)
          : new Decimal(0)
        : usdPerQuote.gt(0)
          ? feeUSD.div(usdPerQuote)
          : new Decimal(0);

    feeItem.amountInBase = feeAmountInBase.toNumber();
    feeItem.amountInQuote = feeAmountInQuote.toNumber();

    // Net received amounts after fees
    const netBaseReceived =
      side === 'buy' ? (isBase ? executedBase.sub(feeAmt) : executedBase) : new Decimal(0);

    const netQuoteReceived =
      side === 'sell' ? executedQuote.sub(isQuote ? feeAmt : new Decimal(0)) : new Decimal(0);

    // Totals in native units (pre/post fee add-ons)
    const totalQuote =
      side === 'buy' ? executedQuote.add(isQuote ? feeAmt : new Decimal(0)) : new Decimal(0);

    const totalBase =
      side === 'sell' ? executedBase.add(isBase ? feeAmt : new Decimal(0)) : new Decimal(0);

    const totalReceivedUsd =
      side === 'buy' ? netBaseReceived.mul(usdPerBase) : netQuoteReceived.mul(usdPerQuote);

    const totalSpentUsd = side === 'buy' ? totalQuote.mul(usdPerQuote) : totalBase.mul(usdPerBase);

    const totalTradeUsd = executionUSD.add(feeUSD);

    return {
      exchange: exchangeName,
      baseAsset,
      quoteAsset,
      sizeAsset,
      side,
      sizeBase: executedBase.toNumber(),
      averagePrice: avgPrice.toNumber(),
      averagePriceUsd: avgPriceUsd.toNumber(),
      referencePrice: referencePrice.toNumber(),
      usdPerBase: usdPerBase.toNumber(),
      usdPerQuote: usdPerQuote.toNumber(),
      feeRateAnalysis: scenario.feeRates.feeRateAnalysis ?? [],
      execution: executionItem,
      slippage: slippageItem,
      tradingFee: feeItem,
      netBaseReceived: netBaseReceived.toNumber(),
      netQuoteReceived: netQuoteReceived.toNumber(),
      totalReceivedUsd: totalReceivedUsd.toNumber(),
      totalSpentUsd: totalSpentUsd.toNumber(),
      totalTradeUsd: totalTradeUsd.toNumber(),
      totalQuote: totalQuote.toNumber(),
      totalBase: totalBase.toNumber(),
    };
  }
}
