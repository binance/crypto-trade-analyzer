import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BinanceBookClient } from '../book-ws-client';
import { MockWebSocket, stubFetchJson } from '../../../test/ws-test-helpers';

function restSnap(lastUpdateId: number) {
  return {
    lastUpdateId,
    bids: [
      ['100', '5'],
      ['99', '3'],
    ],
    asks: [
      ['101', '2'],
      ['102', '1'],
    ],
  };
}

function diff(
  s: string,
  U: number,
  u: number,
  opts: { pu?: number; b?: string[][]; a?: string[][] } = {}
) {
  return {
    stream: `${s.toLowerCase()}@depth@100ms`,
    data: {
      e: 'depthUpdate',
      E: Date.now(),
      s: s.toUpperCase(),
      U,
      u,
      pu: opts.pu,
      b: opts.b ?? [['100', '6']],
      a: opts.a ?? [],
    },
  };
}

function makeClient(market: 'spot' | 'futures' = 'spot') {
  return new BinanceBookClient({
    market,
    streamSpeed: '100ms',
    depthLimit: 5,
    restUrl: 'https://mock.binance.test',
  });
}

async function connectAndWatch(client: BinanceBookClient, pair: string, snap: object) {
  const fetchSpy = stubFetchJson(snap);
  const p = client.watchPair(pair);
  MockWebSocket.current!.triggerOpen();
  await p;
  return fetchSpy;
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BinanceBookClient — snapshot / initial build', () => {
  it('populates bids and asks from the REST snapshot', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTCUSDT', restSnap(1000));

    const ws = MockWebSocket.current!;
    ws.feed(diff('BTCUSDT', 1001, 1001));

    const book = client.getOrderBook('BTCUSDT');
    expect(book).toBeDefined();
    expect(book!.bids[0].price).toBe(100);
    expect(book!.asks[0].price).toBe(101);
  });

  it('book is available immediately after the REST snapshot resync', async () => {
    const client = makeClient();
    stubFetchJson(restSnap(1000));
    const p = client.watchPair('BTCUSDT');
    MockWebSocket.current!.triggerOpen();
    await p;
    const book = client.getOrderBook('BTCUSDT');
    expect(book).toBeDefined();
    expect(book!.bids[0].price).toBe(100);
  });
});

describe('BinanceBookClient — level removal', () => {
  it('removes a bid level when quantity is 0', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 1001, 1001, { b: [['100', '5']] }));
    ws.feed(diff('BTCUSDT', 1002, 1002, { b: [['100', '0']] }));

    const book = client.getOrderBook('BTCUSDT');
    const prices = book!.bids.map((b) => b.price);
    expect(prices).not.toContain(100);
  });
});

describe('BinanceBookClient — spot sequencing', () => {
  it('accepts the first event where U <= lastUpdateId+1 AND u >= lastUpdateId+1', async () => {
    const client = makeClient('spot');
    await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 999, 1001));
    expect(client.getOrderBook('BTCUSDT')).toBeDefined();
  });

  it('rejects a first event where u < lastUpdateId+1 (stale)', async () => {
    const client = makeClient('spot');
    const fetchSpy = await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;
    const callsBefore = fetchSpy.mock.calls.length;

    ws.feed(diff('BTCUSDT', 900, 999));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('detects a gap in subsequent diffs (U !== prevU+1) and resyncs', async () => {
    const client = makeClient('spot');
    const fetchSpy = await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 1001, 1001));
    const callsBefore = fetchSpy.mock.calls.length;

    ws.feed(diff('BTCUSDT', 1003, 1003));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('applies sequential diffs without triggering resync', async () => {
    const client = makeClient('spot');
    const fetchSpy = await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 1001, 1001));
    const callsBefore = fetchSpy.mock.calls.length;

    ws.feed(diff('BTCUSDT', 1002, 1002));
    ws.feed(diff('BTCUSDT', 1003, 1003));
    ws.feed(diff('BTCUSDT', 1004, 1004));

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('ignores duplicate/old diffs (u <= lastEventU)', async () => {
    const client = makeClient('spot');
    const fetchSpy = await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 1001, 1001));
    ws.feed(diff('BTCUSDT', 1002, 1002));
    const callsBefore = fetchSpy.mock.calls.length;

    ws.feed(diff('BTCUSDT', 1001, 1001));
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });
});

describe('BinanceBookClient — futures sequencing (pu-based)', () => {
  it('valid first futures event: U <= lastUpdateId AND u >= lastUpdateId', async () => {
    const client = makeClient('futures');
    await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 999, 1000, { pu: 998 }));
    expect(client.getOrderBook('BTCUSDT')).toBeDefined();
  });

  it('futures contiguity: pu must equal previous u, not u-1', async () => {
    const client = makeClient('futures');
    const fetchSpy = await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 999, 1000, { pu: 998 }));
    const callsBefore = fetchSpy.mock.calls.length;

    ws.feed(diff('BTCUSDT', 1001, 1001, { pu: 1002 }));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('valid futures chain: pu always equals previous u', async () => {
    const client = makeClient('futures');
    const fetchSpy = await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(diff('BTCUSDT', 999, 1000, { pu: 998 }));
    const callsBefore = fetchSpy.mock.calls.length;

    ws.feed(diff('BTCUSDT', 1001, 1001, { pu: 1000 }));
    ws.feed(diff('BTCUSDT', 1002, 1002, { pu: 1001 }));
    ws.feed(diff('BTCUSDT', 1003, 1003, { pu: 1002 }));

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('futures accepts a first event (u >= lastUpdateId) that spot rejects (u < lastUpdateId+1)', async () => {
    const futuresClient = makeClient('futures');
    await connectAndWatch(futuresClient, 'BTCUSDT', restSnap(1000));
    MockWebSocket.current!.feed(diff('BTCUSDT', 999, 1000, { pu: 998, b: [['107', '4']] }));
    const futuresBook = futuresClient.getOrderBook('BTCUSDT')!;
    expect(futuresBook.bids.map((b) => b.price)).toContain(107);

    const spotClient = makeClient('spot');
    const spotFetch = await connectAndWatch(spotClient, 'BTCUSDT', restSnap(1000));
    const callsBefore = spotFetch.mock.calls.length;
    MockWebSocket.current!.feed(diff('BTCUSDT', 999, 1000, { b: [['107', '4']] }));
    expect(spotFetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe('BinanceBookClient — buffer replay', () => {
  it('buffered diffs that predate the snapshot are discarded', async () => {
    const client = makeClient('spot');

    stubFetchJson(restSnap(1000));
    const p = client.watchPair('BTCUSDT');
    MockWebSocket.current!.triggerOpen();

    MockWebSocket.current!.feed(diff('BTCUSDT', 400, 500));
    await p;

    MockWebSocket.current!.feed(diff('BTCUSDT', 1001, 1001, { b: [['105', '7']] }));
    const book = client.getOrderBook('BTCUSDT');
    expect(book).toBeDefined();
  });

  it('buffered diffs with valid sequence are applied after snapshot', async () => {
    const client = makeClient('spot');
    stubFetchJson(restSnap(1000));
    const p = client.watchPair('BTCUSDT');
    MockWebSocket.current!.triggerOpen();

    MockWebSocket.current!.feed(diff('BTCUSDT', 1001, 1001, { b: [['103', '9']] }));
    MockWebSocket.current!.feed(diff('BTCUSDT', 1002, 1002, { b: [['104', '8']] }));
    await p;

    const book = client.getOrderBook('BTCUSDT');
    const prices = book?.bids.map((b) => b.price) ?? [];
    expect(prices).toContain(103);
    expect(prices).toContain(104);
  });
});

describe('BinanceBookClient — sorted output', () => {
  it('getOrderBook returns bids descending and asks ascending', async () => {
    const client = makeClient('spot');
    await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    const ws = MockWebSocket.current!;

    ws.feed(
      diff('BTCUSDT', 1001, 1001, {
        b: [
          ['98', '1'],
          ['100', '3'],
          ['99', '2'],
        ],
        a: [
          ['103', '1'],
          ['101', '2'],
          ['102', '3'],
        ],
      })
    );

    const book = client.getOrderBook('BTCUSDT')!;
    const bids = book.bids.map((b) => b.price);
    const asks = book.asks.map((a) => a.price);
    expect(bids).toEqual([...bids].sort((a, b) => b - a));
    expect(asks).toEqual([...asks].sort((a, b) => a - b));
  });
});

describe('BinanceBookClient — getRawOrderBook vs getOrderBook', () => {
  it('getRawOrderBook keeps fine levels while getOrderBook applies the coarse priceBucket', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTCUSDT', {
      lastUpdateId: 1000,
      bids: [
        ['0.19263', '10'],
        ['0.19262', '20'],
        ['0.19261', '30'],
      ],
      asks: [
        ['0.19264', '5'],
        ['0.19265', '8'],
      ],
    });

    client.priceBucket = 0.1;

    const raw = client.getRawOrderBook('BTCUSDT')!;
    const bucketed = client.getOrderBook('BTCUSDT')!;

    expect(raw.bids.length).toBe(3);
    expect(raw.asks.length).toBe(2);
    expect(bucketed.bids.length).toBeLessThan(raw.bids.length);
  });

  it('getRawOrderBook returns undefined for an unknown pair', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTCUSDT', restSnap(1000));
    expect(client.getRawOrderBook('NOSUCHPAIR')).toBeUndefined();
  });
});

describe('BinanceBookClient — latency timestamp source', () => {
  it('emits message output time (E) as exchangeTs, not transaction time (T)', async () => {
    vi.useFakeTimers();
    try {
      const updates: Array<{ exchangeTs?: number; receiveTs?: number }> = [];
      stubFetchJson(restSnap(1000));
      const client = makeClient('futures');
      client.onUpdate((_pair, book) => updates.push(book));

      const p = client.watchPair('BTCUSDT');
      MockWebSocket.current!.triggerOpen();
      await vi.advanceTimersByTimeAsync(0);
      await p;

      const ws = MockWebSocket.current!;
      ws.feed({
        stream: 'btcusdt@depth@100ms',
        data: {
          e: 'depthUpdate',
          E: 1_000_000_001_500,
          T: 1_000_000_000_100,
          s: 'BTCUSDT',
          U: 999,
          u: 1001,
          pu: 1000,
          b: [['100', '6']],
          a: [],
        },
      });

      await vi.advanceTimersByTimeAsync(1000);

      const last = updates.at(-1)!;
      expect(last.exchangeTs).toBe(1_000_000_001_500);
      expect(typeof last.receiveTs).toBe('number');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not set exchangeTs from a REST snapshot resync', async () => {
    vi.useFakeTimers();
    try {
      const updates: Array<{ exchangeTs?: number }> = [];
      stubFetchJson(restSnap(1000));
      const client = makeClient('futures');
      client.onUpdate((_pair, book) => updates.push(book));

      const p = client.watchPair('BTCUSDT');
      MockWebSocket.current!.triggerOpen();
      await vi.advanceTimersByTimeAsync(0);
      await p;

      await vi.advanceTimersByTimeAsync(1000);

      for (const upd of updates) {
        expect(upd.exchangeTs).toBeUndefined();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
