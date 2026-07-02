import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OkxBookClient } from '../book-ws-client';
import { MockWebSocket, stubFetchJson } from '../../../test/ws-test-helpers';

const REST = {
  code: '0',
  data: [
    {
      bids: [['100', '1', '0', '1']],
      asks: [['101', '1', '0', '1']],
      ts: String(Date.now()),
      seqId: 1000,
    },
  ],
};

function update(
  bids: string[][],
  asks: string[][],
  seqId: number,
  prevSeqId: number,
  ts = Date.now()
) {
  return {
    arg: { channel: 'books', instId: 'BTC-USDT' },
    action: 'update',
    data: [{ bids, asks, ts, seqId, prevSeqId }],
  };
}

function snapshot(bids: string[][], asks: string[][], seqId: number, prevSeqId: number) {
  return {
    arg: { channel: 'books', instId: 'BTC-USDT' },
    action: 'snapshot',
    data: [{ bids, asks, ts: Date.now(), seqId, prevSeqId }],
  };
}

let client: OkxBookClient;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let mockWs: MockWebSocket;

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  client = new OkxBookClient({ depthLimit: 5 });
  fetchSpy = stubFetchJson(REST);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function watchAndOpen() {
  const p = client.watchPair('BTC-USDT');
  mockWs = MockWebSocket.current!;
  mockWs.triggerOpen();
  await p;
}

describe('OkxBookClient — gap detection', () => {
  it('happy path: sequential prevSeqId chain — no resync triggered', async () => {
    await watchAndOpen();
    const callsBefore = fetchSpy.mock.calls.length;

    const base = 1000;
    mockWs.feed(update([['100', '1']], [], base + 1, base));
    mockWs.feed(update([['100', '1']], [], base + 2, base + 1));
    mockWs.feed(update([['100', '1']], [], base + 3, base + 2));

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('sequence gap: prevSeqId skips — triggers resync', async () => {
    await watchAndOpen();
    const callsBefore = fetchSpy.mock.calls.length;

    const base = 1000;
    mockWs.feed(update([['100', '1']], [], base + 1, base));
    mockWs.feed(update([['100', '1']], [], base + 11, base + 10));

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('duplicate seqId is silently dropped — no resync', async () => {
    await watchAndOpen();

    const base = 1000;
    mockWs.feed(update([['100', '1']], [], base + 1, base));
    const callsBefore = fetchSpy.mock.calls.length;
    mockWs.feed(update([['100', '1']], [], base + 1, base));

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('two updates sharing the same ms are both applied (no false resync)', async () => {
    await watchAndOpen();
    const base = 1000;
    const sameTs = Date.now();

    mockWs.feed(update([['99', '5']], [], base + 1, base, sameTs));
    const callsBefore = fetchSpy.mock.calls.length;
    mockWs.feed(update([['98', '3']], [], base + 2, base + 1, sameTs));

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);

    const book = client.getOrderBook('BTC-USDT')!;
    const bidPrices = book.bids.map((b) => b.price);
    expect(bidPrices).toContain(99);
    expect(bidPrices).toContain(98);
  });
});

describe('OkxBookClient — general WS handling', () => {
  it('builds the book from a WS snapshot', async () => {
    await watchAndOpen();
    mockWs.feed(
      snapshot(
        [
          ['100', '5'],
          ['99', '3'],
        ],
        [['101', '2']],
        1000,
        -1
      )
    );
    const book = client.getOrderBook('BTC-USDT')!;
    expect(book.bids[0].price).toBe(100);
    expect(book.asks[0].price).toBe(101);
  });

  it('removes a level when size is 0', async () => {
    await watchAndOpen();
    mockWs.feed(
      snapshot(
        [
          ['100', '5'],
          ['99', '3'],
        ],
        [['101', '2']],
        1000,
        -1
      )
    );
    mockWs.feed(update([['100', '0']], [], 1001, 1000));
    const book = client.getOrderBook('BTC-USDT')!;
    expect(book.bids.map((b) => b.price)).not.toContain(100);
    expect(book.bids.map((b) => b.price)).toContain(99);
  });

  it('returns bids descending and asks ascending', async () => {
    await watchAndOpen();
    mockWs.feed(
      snapshot(
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
        1000,
        -1
      )
    );
    const book = client.getOrderBook('BTC-USDT')!;
    const bids = book.bids.map((b) => b.price);
    const asks = book.asks.map((a) => a.price);
    expect(bids).toEqual([...bids].sort((a, b) => b - a));
    expect(asks).toEqual([...asks].sort((a, b) => a - b));
  });

  it('ignores updates for unknown instruments', async () => {
    await watchAndOpen();
    expect(() =>
      mockWs.feed({
        arg: { channel: 'books', instId: 'ETH-USDT' },
        action: 'update',
        data: [{ bids: [], asks: [], ts: Date.now(), seqId: 5, prevSeqId: 4 }],
      })
    ).not.toThrow();
  });

  it('does not throw on malformed JSON', async () => {
    await watchAndOpen();
    expect(() => mockWs.onmessage?.({ data: '{bad' } as MessageEvent)).not.toThrow();
  });

  it('ignores event/error frames without data', async () => {
    await watchAndOpen();
    expect(() => mockWs.feed({ event: 'error', code: '60012', msg: 'bad' })).not.toThrow();
  });
});

describe('OkxBookClient — getRawOrderBook vs getOrderBook', () => {
  it('getRawOrderBook keeps fine levels while getOrderBook applies the coarse priceBucket', async () => {
    await watchAndOpen();
    mockWs.feed(
      snapshot(
        [
          ['0.19263', '10', '0', '1'],
          ['0.19262', '20', '0', '1'],
          ['0.19261', '30', '0', '1'],
        ],
        [
          ['0.19264', '5', '0', '1'],
          ['0.19265', '8', '0', '1'],
        ],
        1001,
        1000
      )
    );

    client.priceBucket = 0.1;

    const raw = client.getRawOrderBook('BTC-USDT')!;
    const bucketed = client.getOrderBook('BTC-USDT')!;

    expect(raw.bids.length).toBe(3);
    expect(raw.asks.length).toBe(2);
    expect(bucketed.bids.length).toBeLessThan(raw.bids.length);
  });

  it('getRawOrderBook returns undefined for an unknown pair', async () => {
    await watchAndOpen();
    expect(client.getRawOrderBook('NOSUCHPAIR')).toBeUndefined();
  });
});
