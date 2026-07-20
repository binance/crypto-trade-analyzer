import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BybitBookClient } from '../book-ws-client';
import { MockWebSocket, stubFetchJson } from '../../../test/ws-test-helpers';

const REST = {
  retCode: 0,
  result: { s: 'BTCUSDT', b: [['100', '1']], a: [['101', '1']], ts: Date.now(), u: 500, seq: 999 },
};

function msg(type: 'snapshot' | 'delta', b: string[][], a: string[][], u: number, seq: number) {
  return {
    topic: 'orderbook.1000.BTCUSDT',
    type,
    data: { s: 'BTCUSDT', b, a, u, seq, ts: Date.now() },
  };
}

function tsMsg(type: 'snapshot' | 'delta', u: number, seq: number, outerTs: number, cts?: number) {
  return {
    topic: 'orderbook.1000.BTCUSDT',
    type,
    ts: outerTs,
    data: { s: 'BTCUSDT', b: [['100', '1']], a: [['101', '1']], u, seq, cts },
  };
}

let client: BybitBookClient;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let mockWs: MockWebSocket;

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  client = new BybitBookClient({ category: 'linear', depthLimit: 1000 });
  fetchSpy = stubFetchJson(REST);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openAndSubscribe() {
  const p = client.watchPair('BTCUSDT');
  mockWs = MockWebSocket.current!;
  mockWs.triggerOpen();
  await p;
}

describe('BybitBookClient — gap detection', () => {
  it('happy path: u increments by 1 each delta — no resync', async () => {
    await openAndSubscribe();
    mockWs.feed(msg('snapshot', [['100', '1']], [['101', '1']], 500, 1000));
    const callsBefore = fetchSpy.mock.calls.length;

    mockWs.feed(msg('delta', [['100', '1']], [], 501, 1001));
    mockWs.feed(msg('delta', [['100', '1']], [], 502, 1002));
    mockWs.feed(msg('delta', [['100', '1']], [], 503, 1003));

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('gap in u — triggers resync', async () => {
    await openAndSubscribe();
    mockWs.feed(msg('snapshot', [['100', '1']], [['101', '1']], 500, 1000));
    const callsBefore = fetchSpy.mock.calls.length;

    mockWs.feed(msg('delta', [['100', '1']], [], 501, 1001));
    mockWs.feed(msg('delta', [['100', '1']], [], 510, 1002));

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('duplicate u is silently dropped — no resync', async () => {
    await openAndSubscribe();
    mockWs.feed(msg('snapshot', [['100', '1']], [['101', '1']], 500, 1000));
    mockWs.feed(msg('delta', [['100', '1']], [], 501, 1001));
    const callsBefore = fetchSpy.mock.calls.length;

    mockWs.feed(msg('delta', [['100', '1']], [], 501, 1001));

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('book recovers (resync completes) after a gap and in-flight buffered deltas', async () => {
    await openAndSubscribe();
    mockWs.feed(msg('snapshot', [['100', '1']], [['101', '1']], 500, 1000));

    mockWs.feed(msg('delta', [['100', '1']], [], 510, 1002));
    mockWs.feed(msg('delta', [['100', '1']], [], 511, 1003));
    mockWs.feed(msg('delta', [['100', '1']], [], 512, 1004));

    await vi.waitFor(() => expect(client.getOrderBook('BTCUSDT')).toBeDefined());
    const book = client.getOrderBook('BTCUSDT')!;
    expect(book.bids.length).toBeGreaterThan(0);
  });
});

describe('BybitBookClient — general WS handling', () => {
  it('builds the book from a WS snapshot', async () => {
    await openAndSubscribe();
    mockWs.feed(
      msg(
        'snapshot',
        [
          ['100', '5'],
          ['99', '3'],
        ],
        [['101', '2']],
        500,
        1000
      )
    );
    const book = client.getOrderBook('BTCUSDT')!;
    expect(book.bids[0].price).toBe(100);
    expect(book.asks[0].price).toBe(101);
  });

  it('removes a level when size is 0 via delta', async () => {
    await openAndSubscribe();
    mockWs.feed(
      msg(
        'snapshot',
        [
          ['100', '5'],
          ['99', '3'],
        ],
        [['101', '2']],
        500,
        1000
      )
    );
    mockWs.feed(msg('delta', [['100', '0']], [], 501, 1001));
    const book = client.getOrderBook('BTCUSDT')!;
    expect(book.bids.map((b) => b.price)).not.toContain(100);
    expect(book.bids.map((b) => b.price)).toContain(99);
  });

  it('applies a delta updating an existing level', async () => {
    await openAndSubscribe();
    mockWs.feed(msg('snapshot', [['100', '5']], [['101', '2']], 500, 1000));
    mockWs.feed(msg('delta', [['100', '8']], [], 501, 1001));
    const book = client.getOrderBook('BTCUSDT')!;
    expect(book.bids.find((b) => b.price === 100)!.quantity).toBe(8);
  });

  it('returns bids descending and asks ascending', async () => {
    await openAndSubscribe();
    mockWs.feed(
      msg(
        'snapshot',
        [
          ['98', '1'],
          ['100', '3'],
          ['99', '2'],
        ],
        [
          ['103', '1'],
          ['101', '2'],
          ['102', '3'],
        ],
        500,
        1000
      )
    );
    const book = client.getOrderBook('BTCUSDT')!;
    const bids = book.bids.map((b) => b.price);
    const asks = book.asks.map((a) => a.price);
    expect(bids).toEqual([...bids].sort((a, b) => b - a));
    expect(asks).toEqual([...asks].sort((a, b) => a - b));
  });

  it('does not throw on malformed JSON', async () => {
    await openAndSubscribe();
    expect(() => mockWs.onmessage?.({ data: 'nope' } as MessageEvent)).not.toThrow();
  });

  it('ignores subscription ack frames', async () => {
    await openAndSubscribe();
    expect(() => mockWs.feed({ op: 'subscribe', success: true, retCode: 0 })).not.toThrow();
  });
});

describe('BybitBookClient — latency timestamp source', () => {
  it('emits outer ts (system data time) as exchangeTs, preferring it over cts', async () => {
    vi.useFakeTimers();
    try {
      const updates: Array<{ exchangeTs?: number; receiveTs?: number }> = [];
      client.onUpdate((_pair, book) => updates.push(book));

      const p = client.watchPair('BTCUSDT');
      mockWs = MockWebSocket.current!;
      mockWs.triggerOpen();
      await vi.advanceTimersByTimeAsync(0);
      await p;

      mockWs.feed(tsMsg('snapshot', 500, 1000, 1_000_000_000_000));
      mockWs.feed(tsMsg('delta', 501, 1001, 1_000_000_000_500, 1_000_000_000_400));

      await vi.advanceTimersByTimeAsync(1000);

      const last = updates.at(-1)!;
      expect(last.exchangeTs).toBe(1_000_000_000_500);
      expect(typeof last.receiveTs).toBe('number');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to cts when outer ts is absent', async () => {
    vi.useFakeTimers();
    try {
      const updates: Array<{ exchangeTs?: number }> = [];
      client.onUpdate((_pair, book) => updates.push(book));

      const p = client.watchPair('BTCUSDT');
      mockWs = MockWebSocket.current!;
      mockWs.triggerOpen();
      await vi.advanceTimersByTimeAsync(0);
      await p;

      mockWs.feed({
        topic: 'orderbook.1000.BTCUSDT',
        type: 'snapshot',
        data: { s: 'BTCUSDT', b: [['100', '1']], a: [['101', '1']], u: 500, seq: 1000 },
      });
      mockWs.feed({
        topic: 'orderbook.1000.BTCUSDT',
        type: 'delta',
        data: {
          s: 'BTCUSDT',
          b: [['100', '1']],
          a: [['101', '1']],
          u: 501,
          seq: 1001,
          cts: 1_000_000_000_700,
        },
      });

      await vi.advanceTimersByTimeAsync(1000);

      expect(updates.at(-1)!.exchangeTs).toBe(1_000_000_000_700);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BybitBookClient — getRawOrderBook vs getOrderBook', () => {
  it('getRawOrderBook returns fine-grained levels regardless of priceBucket', async () => {
    await openAndSubscribe();
    mockWs.feed(
      msg(
        'snapshot',
        [
          ['0.3', '10'],
          ['0.2', '20'],
          ['0.1', '30'],
        ],
        [
          ['0.4', '5'],
          ['0.5', '8'],
        ],
        500,
        1000
      )
    );

    client.priceBucket = 0.1;

    const raw = client.getRawOrderBook('BTCUSDT')!;
    const bucketed = client.getOrderBook('BTCUSDT')!;

    expect(raw.bids.length).toBe(3);
    expect(raw.asks.length).toBe(2);

    expect(bucketed.bids.length).toBeLessThanOrEqual(raw.bids.length);
  });

  it('getRawOrderBook returns undefined for an unknown pair', async () => {
    await openAndSubscribe();
    expect(client.getRawOrderBook('NOSUCHPAIR')).toBeUndefined();
  });
});
