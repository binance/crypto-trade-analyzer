import {
  bucketizeOrderBook,
  emitOrderBookUpdate,
  sendWsMessage,
  sleep,
  withHttpRetry,
} from '../../utils/utils';
import {
  REST_API_URL,
  DEPTH_LIMIT,
  MAX_BUFFERED_DIFFS,
  SOCKET_URL,
  STREAM_SPEED,
} from './utils/constants';
import { EMIT_INTERVAL_MS } from '../../utils/constants';
import type { OrderBook, OrderBookEntry } from '../../core/interfaces/order-book';
import type { BookWsClient, OrderBookListener } from '../../core/interfaces/book-ws-client';

/**
 * Represents a depth update event from the Binance WebSocket API.
 */
type DepthDiff = {
  stream: string;
  data: {
    e: 'depthUpdate';
    E: number;
    s: string;
    U: number;
    u: number;
    b: [string, string][];
    a: [string, string][];
  };
};

/**
 * Represents the state of the order book for a trading pair.
 */
type BookState = {
  syncing: boolean;
  lastUpdateId?: number;
  lastEventU?: number;
  buffer: DepthDiff['data'][];
  bids: Map<string, number>;
  asks: Map<string, number>;
  dirty: boolean;
  lastEmit: number;
  interval?: ReturnType<typeof setInterval>;
};

/**
 * Represents the response from the Binance depth REST API.
 */
export interface BinanceDepthRestResponse {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

/**
 * Represents the options for the Binance book WebSocket client.
 */
export type BinanceBookClientOptions = {
  socketUrl?: string;
  streamSpeed?: '100ms' | '1000ms';
  depthLimit?: number;
  emitIntervalMs?: number;
  maxBufferedDiffs?: number;
};

export class BinanceBookClient implements BookWsClient {
  private ws?: WebSocket;
  private wsState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private nextId = 1;
  private desiredStreams = new Set<string>();
  private subscribedStreams = new Set<string>();
  private states = new Map<string, BookState>();
  private listeners = new Set<OrderBookListener>();
  priceBucket: number | undefined;

  constructor(private opts: BinanceBookClientOptions = {}) {}

  /**
   * Pushes a depth update event to the buffer.
   *
   * @private
   * @param state The current state of the order book.
   * @param evt The depth update event.
   */
  private pushBuffered(state: BookState, evt: DepthDiff['data'], pairKey: string) {
    const cap = this.opts?.maxBufferedDiffs ?? MAX_BUFFERED_DIFFS;
    if (state.buffer.length >= cap) state.buffer.shift();

    if (state.syncing) {
      state.buffer.push(evt);
      return;
    }

    if (state.buffer.length >= Math.floor(cap * 0.8)) {
      console.debug(`Buffer near capacity, resyncing Binance ${pairKey}`);
      state.syncing = true;
      state.buffer.push(evt);
      this.resync(pairKey).catch(() => {});
      return;
    }

    state.buffer.push(evt);
  }

  /**
   * Resynchronizes the order book for a trading pair.
   *
   * @private
   * @param pairKey The trading pair key.
   * @param depthLimit The maximum depth of the order book to retrieve.
   * @returns A promise that resolves when the resynchronization is complete.
   */
  private async resync(pairKey: string, depthLimit?: number): Promise<void> {
    const state = this.states.get(pairKey);
    if (!state) return;
    state.syncing = true;

    console.debug(`Resyncing order book for Binance ${pairKey}...`);

    const url = `${REST_API_URL}/depth?symbol=${pairKey}&limit=${depthLimit ?? this.opts.depthLimit ?? DEPTH_LIMIT}`;
    const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bookSnapshot = (await resp.json()) as BinanceDepthRestResponse;

    state.bids.clear();
    state.asks.clear();

    for (const [price, quantity] of bookSnapshot.bids) state.bids.set(price, Number(quantity));

    for (const [price, quantity] of bookSnapshot.asks) state.asks.set(price, Number(quantity));

    state.lastUpdateId = bookSnapshot.lastUpdateId;

    const buf = state.buffer.sort((a, b) => a.U - b.U);
    let i = 0;
    while (i < buf.length && buf[i].u <= bookSnapshot.lastUpdateId) i++;

    if (
      i < buf.length &&
      buf[i].U <= bookSnapshot.lastUpdateId + 1 &&
      buf[i].u >= bookSnapshot.lastUpdateId + 1
    ) {
      let prevU = buf[i].u;
      this.applyEvent(state, buf[i]);
      i++;

      for (; i < buf.length; i++) {
        const ev = buf[i];

        if (ev.u <= prevU) continue;

        if (ev.U !== prevU + 1) {
          state.buffer = [];
          return this.resync(pairKey, depthLimit);
        }

        this.applyEvent(state, ev);
        prevU = ev.u;
      }

      state.lastEventU = prevU;
    }

    state.buffer = [];
    state.syncing = false;
    state.dirty = true;
  }

  /**
   * Handles incoming WebSocket message.
   *
   * @private
   * @param msg The WebSocket message event.
   * @returns
   */
  private onMessage = (msg: MessageEvent) => {
    try {
      const parsedMessage = JSON.parse(msg.data as string) as DepthDiff;
      const evt = parsedMessage.data;
      if (!evt?.s || !evt?.U || !evt?.u) return;

      const pairKey = evt.s.toUpperCase();
      const state = this.states.get(pairKey);
      if (!state) return;

      if (state.syncing || state.lastUpdateId == null) {
        this.pushBuffered(state, evt, pairKey);
        return;
      }

      if (state.lastEventU == null) {
        if (!(evt.U <= state.lastUpdateId + 1 && evt.u >= state.lastUpdateId + 1)) {
          this.pushBuffered(state, evt, pairKey);
          state.syncing = true;
          this.resync(pairKey).catch(() => {});
          return;
        }
      } else {
        if (evt.u <= state.lastEventU) return;
        if (evt.U !== state.lastEventU + 1) {
          this.pushBuffered(state, evt, pairKey);
          state.syncing = true;
          this.resync(pairKey).catch(() => {});
          return;
        }
      }

      this.applyEvent(state, evt);
      state.lastEventU = evt.u;
      state.dirty = true;
    } catch (err) {
      console.warn('Failed to process Binance WebSocket message', err);
    }
  };

  /**
   * Applies a depth update event to the order book state.
   *
   * @private
   * @param state The order book state to update.
   * @param evt The depth update event.
   */
  private applyEvent(state: BookState, evt: DepthDiff['data']) {
    for (const [priceStr, qtyStr] of evt.b) {
      const qty = Number(qtyStr);

      if (qty === 0) state.bids.delete(priceStr);
      else state.bids.set(priceStr, qty);
    }

    for (const [priceStr, qtyStr] of evt.a) {
      const qty = Number(qtyStr);

      if (qty === 0) state.asks.delete(priceStr);
      else state.asks.set(priceStr, qty);
    }
  }

  /**
   * Reconnects to the Binance WebSocket.
   *
   * @private
   */
  private async reconnect(): Promise<void> {
    console.debug('Reconnecting to Binance WebSocket...');

    this.disconnect();
    await sleep(1000);
    await this.connect();

    for (const pair of this.states.keys()) this.resync(pair).catch(() => {});
  }

  /**
   * Connects to the Binance WebSocket.
   *
   * @returns {Promise<void>}
   */
  connect(): Promise<void> {
    if (this.ws || this.wsState === 'connecting' || this.wsState === 'connected')
      return Promise.resolve();

    console.debug('Connecting to Binance WebSocket...');

    const socket = new WebSocket(this.opts.socketUrl ?? SOCKET_URL);
    if (!socket) throw new Error('No WebSocket available');
    this.ws = socket;
    this.wsState = 'connecting';
    this.subscribedStreams.clear();

    return new Promise((resolve, reject) => {
      this.ws!.onopen = () => {
        console.debug('Binance WebSocket connected');
        this.wsState = 'connected';

        const params = Array.from(this.desiredStreams);
        if (params.length) {
          sendWsMessage(this.ws!, { method: 'SUBSCRIBE', params, id: this.nextId++ });
          params.forEach((s) => this.subscribedStreams.add(s));
        }

        resolve();
      };

      this.ws!.onmessage = this.onMessage;

      this.ws!.onclose = async (evt: CloseEvent) => {
        console.debug('Binance WebSocket disconnected');
        this.wsState = 'disconnected';
        this.subscribedStreams.clear();
        await sleep(500 + Math.floor(Math.random() * 700));
        if (evt?.code !== 1000) this.reconnect();
      };

      this.ws!.onerror = (err) => {
        console.error('Binance WebSocket error:', err);
        reject(err as unknown as Error);
      };
    });
  }

  /**
   * Disconnects from the Binance WebSocket.
   *
   * @returns {void}
   */
  disconnect(): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.close(1000, 'Normal closure');
    this.wsState = 'disconnected';
    this.ws = undefined;
    this.subscribedStreams.clear();
    this.desiredStreams.clear();
    this.states.forEach((state) => (state.interval ? clearInterval(state.interval) : undefined));
    this.states.clear();
    this.listeners.clear();
    this.priceBucket = undefined;
  }

  /**
   * Watches a trading pair for depth updates.
   *
   * @param pair The trading pair to watch (e.g., "BTCUSDT").
   * @param depthLimit The maximum depth of the order book to retrieve.
   */
  async watchPair(pair: string, depthLimit?: number) {
    if (!this.states.has(pair))
      this.states.set(pair, {
        syncing: true,
        buffer: [],
        bids: new Map(),
        asks: new Map(),
        dirty: false,
        lastEmit: 0,
      });

    const stream = `${pair.toLowerCase()}@depth@${this.opts.streamSpeed ?? STREAM_SPEED}`;
    this.desiredStreams.add(stream);

    await this.connect();

    console.debug(`Subscribing to Binance ${stream}...`);
    if (this.ws && this.wsState === 'connected' && !this.subscribedStreams.has(stream)) {
      sendWsMessage(this.ws, { method: 'SUBSCRIBE', params: [stream], id: this.nextId++ });
      this.subscribedStreams.add(stream);
    }

    const state = this.states.get(pair)!;
    if (!state.interval)
      state.interval = setInterval(() => {
        if (!state.dirty) return;
        state.dirty = false;
        state.lastEmit = Date.now();

        const book = this.getOrderBook(pair);
        if (book) emitOrderBookUpdate(this.listeners, pair, book, 'binance');
      }, this.opts.emitIntervalMs ?? EMIT_INTERVAL_MS);

    await this.resync(pair, depthLimit);
  }

  /**
   * Stops watching a trading pair for depth updates.
   *
   * @param pair The trading pair to unwatch (e.g., "BTCUSDT").
   */
  unwatchPair(pair: string) {
    console.debug(`Unsubscribing from Binance ${pair}...`);

    const stream = `${pair.toLowerCase()}@depth@${this.opts.streamSpeed ?? STREAM_SPEED}`;

    if (this.ws && this.wsState === 'connected' && this.desiredStreams.delete(stream)) {
      sendWsMessage(this.ws, { method: 'UNSUBSCRIBE', params: [stream], id: this.nextId++ });
      this.subscribedStreams.delete(stream);
      this.priceBucket = undefined;
    }
    const state = this.states.get(pair);
    if (state?.interval) clearInterval(state.interval);
    this.states.delete(pair);
  }

  /**
   * Adds a listener for order book updates.
   *
   * @param cb The listener callback to add.
   * @returns A function to remove the listener.
   */
  onUpdate(cb: OrderBookListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Gets the order book for a trading pair.
   *
   * @param pairKey The trading pair or key to retrieve the order book for.
   * @returns The order book for the specified trading pair, or undefined if not available.
   */
  getOrderBook(pairKey: string): OrderBook | undefined {
    const state = this.states.get(pairKey);
    if (!state || state.syncing || state.lastUpdateId == null) return;

    const bids: OrderBookEntry[] = Array.from(state.bids.entries())
      .filter(([, q]) => q > 0)
      .map(([p, q]) => ({ price: Number(p), quantity: q }))
      .sort((a, b) => b.price - a.price);

    const asks: OrderBookEntry[] = Array.from(state.asks.entries())
      .filter(([, q]) => q > 0)
      .map(([p, q]) => ({ price: Number(p), quantity: q }))
      .sort((a, b) => a.price - b.price);

    return bucketizeOrderBook({ bids, asks }, this.priceBucket!);
  }
}
