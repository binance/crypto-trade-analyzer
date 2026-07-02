import { describe, it, expect, vi } from 'vitest';
import { OkxAdapter } from '../adapter';
import { CostCalculator } from '../../../core/services/cost-calculator';
import { USDConverter } from '../../../core/services/usd-converter';
import type { OkxBookClient } from '../book-ws-client';
import type { OrderBook } from '../../../core/interfaces/order-book';

function makeAdapter(market: 'spot' | 'futures' = 'spot') {
  return new OkxAdapter(new CostCalculator(new USDConverter()), market);
}

function setCtVal(adapter: OkxAdapter, instId: string, ctVal: number) {
  (adapter as unknown as { ctValCache: Map<string, number> }).ctValCache.set(instId, ctVal);
}

function getBookWs(adapter: OkxAdapter): OkxBookClient {
  return (adapter as unknown as { bookWs: OkxBookClient }).bookWs;
}

const RAW_BOOK: OrderBook = {
  bids: [{ price: 100, quantity: 500 }],
  asks: [{ price: 101, quantity: 200 }],
};

describe('OkxAdapter — ctVal scaling (getRawOrderBook)', () => {
  it('returns undefined when bookWs has no data', () => {
    const adapter = makeAdapter('futures');
    expect(adapter.getRawOrderBook('BTC-USDT-SWAP')).toBeUndefined();
  });

  it('scales quantities by ctVal for SWAP', () => {
    const adapter = makeAdapter('futures');
    vi.spyOn(getBookWs(adapter), 'getRawOrderBook').mockReturnValue(RAW_BOOK);
    setCtVal(adapter, 'BTC-USDT-SWAP', 0.01);

    const book = adapter.getRawOrderBook('BTC-USDT-SWAP')!;
    expect(book.bids[0].quantity).toBeCloseTo(5); // 500 * 0.01
    expect(book.asks[0].quantity).toBeCloseTo(2); // 200 * 0.01
    expect(book.bids[0].price).toBe(100); // prices unchanged
  });

  it('defaults to ctVal=1 (no scaling) when cache has no entry for SWAP', () => {
    const adapter = makeAdapter('futures');
    vi.spyOn(getBookWs(adapter), 'getRawOrderBook').mockReturnValue(RAW_BOOK);

    const book = adapter.getRawOrderBook('BTC-USDT-SWAP')!;
    expect(book.bids[0].quantity).toBe(500);
    expect(book.asks[0].quantity).toBe(200);
  });

  it('does NOT scale quantities for SPOT regardless of any cache entry', () => {
    const adapter = makeAdapter('spot');
    vi.spyOn(getBookWs(adapter), 'getRawOrderBook').mockReturnValue(RAW_BOOK);
    setCtVal(adapter, 'BTC-USDT', 0.01); // should be ignored

    const book = adapter.getRawOrderBook('BTC-USDT')!;
    expect(book.bids[0].quantity).toBe(500);
    expect(book.asks[0].quantity).toBe(200);
  });
});

describe('OkxAdapter — ctVal scaling (onLiveBook)', () => {
  it('scales live book quantities by ctVal for SWAP before forwarding to callback', () => {
    const adapter = makeAdapter('futures');
    const bookWs = getBookWs(adapter);

    let captured: ((key: string, book: OrderBook) => void) | null = null;
    vi.spyOn(bookWs, 'onUpdate').mockImplementation((cb) => {
      captured = cb;
      return () => {};
    });

    setCtVal(adapter, 'BTC-USDT-SWAP', 0.01);

    const received: { key: string; book: OrderBook }[] = [];
    adapter.onLiveBook((k, b) => received.push({ key: k, book: b }));

    captured!('BTC-USDT-SWAP', RAW_BOOK);

    expect(received).toHaveLength(1);
    expect(received[0].book.bids[0].quantity).toBeCloseTo(5); // 500 * 0.01
    expect(received[0].book.asks[0].quantity).toBeCloseTo(2); // 200 * 0.01
  });

  it('passes live book through unchanged for SPOT', () => {
    const adapter = makeAdapter('spot');
    const bookWs = getBookWs(adapter);

    let captured: ((key: string, book: OrderBook) => void) | null = null;
    vi.spyOn(bookWs, 'onUpdate').mockImplementation((cb) => {
      captured = cb;
      return () => {};
    });

    const received: { key: string; book: OrderBook }[] = [];
    adapter.onLiveBook((k, b) => received.push({ key: k, book: b }));

    captured!('BTC-USDT', RAW_BOOK);

    expect(received[0].book.bids[0].quantity).toBe(500);
    expect(received[0].book.asks[0].quantity).toBe(200);
  });

  it('uses ctVal=1 when cache has no entry, leaving quantities unchanged', () => {
    const adapter = makeAdapter('futures');
    const bookWs = getBookWs(adapter);

    let captured: ((key: string, book: OrderBook) => void) | null = null;
    vi.spyOn(bookWs, 'onUpdate').mockImplementation((cb) => {
      captured = cb;
      return () => {};
    });

    const received: OrderBook[] = [];
    adapter.onLiveBook((_, b) => received.push(b));
    captured!('BTC-USDT-SWAP', RAW_BOOK);

    expect(received[0].bids[0].quantity).toBe(500);
    expect(received[0].asks[0].quantity).toBe(200);
  });
});

describe('OkxAdapter — setPriceBucket', () => {
  it('updates the adapter price bucket and the underlying WS client in sync', () => {
    const adapter = makeAdapter();
    const bookWs = (adapter as unknown as { bookWs: OkxBookClient }).bookWs;

    adapter.setPriceBucket(0.00001);
    expect(adapter.priceBucket).toBe(0.00001);
    expect(bookWs.priceBucket).toBe(0.00001);
  });

  it('clears the bucket on both when set to undefined', () => {
    const adapter = makeAdapter();
    const bookWs = (adapter as unknown as { bookWs: OkxBookClient }).bookWs;

    adapter.setPriceBucket(0.1);
    adapter.setPriceBucket(undefined);
    expect(adapter.priceBucket).toBeUndefined();
    expect(bookWs.priceBucket).toBeUndefined();
  });

  it('overrides a previously set coarse bucket with a finer one', () => {
    const adapter = makeAdapter();
    const bookWs = (adapter as unknown as { bookWs: OkxBookClient }).bookWs;

    adapter.setPriceBucket(0.1);
    adapter.setPriceBucket(0.00001);
    expect(adapter.priceBucket).toBe(0.00001);
    expect(bookWs.priceBucket).toBe(0.00001);
  });
});
