import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoinbaseBookClient } from '../book-ws-client';
import { MockWebSocket, stubFetchJson } from '../../../test/ws-test-helpers';

const REST = {
  bids: [
    ['100', '5'],
    ['99', '3'],
  ],
  asks: [
    ['101', '2'],
    ['102', '1'],
  ],
};

function snapshot(productId: string, bids: string[][], asks: string[][]) {
  return { type: 'snapshot', product_id: productId, bids, asks };
}

function l2update(productId: string, changes: ['buy' | 'sell', string, string][]) {
  return { type: 'l2update', product_id: productId, time: new Date(0).toISOString(), changes };
}

function makeClient() {
  return new CoinbaseBookClient({ socketUrl: 'wss://mock.coinbase.test' });
}

async function connectAndWatch(client: CoinbaseBookClient, productId: string) {
  const fetchSpy = stubFetchJson(REST);
  const p = client.watchPair(productId);
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

describe('CoinbaseBookClient — snapshot', () => {
  it('builds the book from a WS snapshot', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;

    ws.feed(
      snapshot(
        'BTC-USD',
        [
          ['100', '5'],
          ['99', '3'],
        ],
        [
          ['101', '2'],
          ['102', '1'],
        ]
      )
    );

    const book = client.getOrderBook('BTC-USD');
    expect(book).toBeDefined();
    expect(book!.bids[0].price).toBe(100);
    expect(book!.asks[0].price).toBe(101);
  });

  it('ignores messages for unknown products', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;

    ws.feed(snapshot('ETH-USD', [['1', '1']], [['2', '1']]));
    expect(() => client.getOrderBook('BTC-USD')).not.toThrow();
  });
});

describe('CoinbaseBookClient — l2update', () => {
  it('applies buy/sell changes to the right side', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;
    ws.feed(snapshot('BTC-USD', [['100', '5']], [['101', '2']]));

    ws.feed(
      l2update('BTC-USD', [
        ['buy', '100', '7'],
        ['sell', '101', '4'],
      ])
    );

    const book = client.getOrderBook('BTC-USD')!;
    expect(book.bids.find((b) => b.price === 100)!.quantity).toBe(7);
    expect(book.asks.find((a) => a.price === 101)!.quantity).toBe(4);
  });

  it('removes a level when size is 0', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;
    ws.feed(
      snapshot(
        'BTC-USD',
        [
          ['100', '5'],
          ['99', '3'],
        ],
        [['101', '2']]
      )
    );

    ws.feed(l2update('BTC-USD', [['buy', '100', '0']]));

    const book = client.getOrderBook('BTC-USD')!;
    expect(book.bids.map((b) => b.price)).not.toContain(100);
    expect(book.bids.map((b) => b.price)).toContain(99);
  });

  it('adds a new level via l2update', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;
    ws.feed(snapshot('BTC-USD', [['100', '5']], [['101', '2']]));

    ws.feed(l2update('BTC-USD', [['buy', '99.5', '10']]));

    const book = client.getOrderBook('BTC-USD')!;
    expect(book.bids.find((b) => b.price === 99.5)!.quantity).toBe(10);
  });
});

describe('CoinbaseBookClient — buffering and ordering', () => {
  it('buffers l2updates that arrive before the snapshot, then replays them', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;

    ws.feed(l2update('BTC-USD', [['buy', '100', '9']]));
    ws.feed(snapshot('BTC-USD', [['100', '5']], [['101', '2']]));

    const book = client.getOrderBook('BTC-USD')!;
    expect(book.bids.find((b) => b.price === 100)!.quantity).toBe(9);
  });

  it('getOrderBook returns bids descending and asks ascending', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;

    ws.feed(
      snapshot(
        'BTC-USD',
        [
          ['98', '1'],
          ['100', '3'],
          ['99', '2'],
        ],
        [
          ['103', '1'],
          ['101', '2'],
          ['102', '3'],
        ]
      )
    );

    const book = client.getOrderBook('BTC-USD')!;
    const bids = book.bids.map((b) => b.price);
    const asks = book.asks.map((a) => a.price);
    expect(bids).toEqual([...bids].sort((a, b) => b - a));
    expect(asks).toEqual([...asks].sort((a, b) => a - b));
  });
});

describe('CoinbaseBookClient — resilience', () => {
  it('does not throw on malformed JSON', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;
    expect(() => ws.onmessage?.({ data: 'not json{' } as MessageEvent)).not.toThrow();
  });

  it('ignores messages with no type', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;
    expect(() => ws.feed({ product_id: 'BTC-USD' })).not.toThrow();
  });
});

describe('CoinbaseBookClient — getRawOrderBook vs getOrderBook', () => {
  it('getRawOrderBook keeps fine levels while getOrderBook applies the coarse priceBucket', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    const ws = MockWebSocket.current!;

    ws.feed(
      snapshot(
        'BTC-USD',
        [
          ['0.19263', '10'],
          ['0.19262', '20'],
          ['0.19261', '30'],
        ],
        [
          ['0.19264', '5'],
          ['0.19265', '8'],
        ]
      )
    );

    client.priceBucket = 0.1;

    const raw = client.getRawOrderBook('BTC-USD')!;
    const bucketed = client.getOrderBook('BTC-USD')!;

    expect(raw.bids.length).toBe(3);
    expect(raw.asks.length).toBe(2);
    expect(bucketed.bids.length).toBeLessThan(raw.bids.length);
  });

  it('getRawOrderBook returns undefined for an unknown pair', async () => {
    const client = makeClient();
    await connectAndWatch(client, 'BTC-USD');
    expect(client.getRawOrderBook('NOSUCHPAIR')).toBeUndefined();
  });
});
