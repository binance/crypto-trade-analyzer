import {
  bucketizeOrderBook,
  emitOrderBookUpdate,
  sendWsMessage,
  sleep,
  withHttpRetry,
} from '../../utils/utils';
import { DEPTH_LIMIT, MAX_BUFFERED_UPDATES, REST_API_URL, SOCKET_URL } from './utils/constants';
import { EMIT_INTERVAL_MS } from '../../utils/constants';
import type { OrderBook, OrderBookEntry } from '../../core/interfaces/order-book';
import type { BookWsClient, OrderBookListener } from '../../core/interfaces/book-ws-client';

/**
 * OKX order book message data.
 */
type OkxBookMsgData = {
  asks: string[][];
  bids: string[][];
  ts: number;
};

/**
 * OKX order book message.
 */
type OkxBooksMsg = {
  arg?: { channel: string; instId: string };
  action?: 'snapshot' | 'update';
  data?: OkxBookMsgData[];
  event?: string;
  code?: string;
  msg?: string;
};

/**
 * OKX order book message data.
 */
type BookState = {
  syncing: boolean;
  bids: Map<string, number>;
  asks: Map<string, number>;
  dirty: boolean;
  lastEmit: number;
  buffer: OkxBookMsgData[];
  lastTs?: number;
  interval?: ReturnType<typeof setInterval>;
};

/**
 * OKX order book REST response.
 */
export interface OkxBookRestResponse {
  code: string;
  msg: string;
  data: OkxBookMsgData[];
}

/**
 * OKX order book client options.
 */
export type OkxBookClientOptions = {
  socketUrl?: string;
  depthLimit?: number;
  emitIntervalMs?: number;
  maxBufferedUpdates?: number;
};

export class OkxBookClient implements BookWsClient {
  private ws?: WebSocket;
  private wsState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private desiredArgs = new Map<string, { channel: string; instId: string }>();
  private subscribedArgs = new Set<string>();
  private states = new Map<string, BookState>();
  private listeners = new Set<OrderBookListener>();
  private channel = 'books';
  priceBucket: number | undefined;

  constructor(private opts: OkxBookClientOptions = {}) {}

  /**
   * Pushes a new order book update to the buffer with capacity management.
   *
   * @private
   * @param state The current state of the order book.
   * @param datum The new order book update data.
   * @param instId The instrument ID for logging.
   */
  private pushBuffered(state: BookState, datum: OkxBookMsgData, instId: string) {
    const maxBuffer = this.opts.maxBufferedUpdates ?? MAX_BUFFERED_UPDATES;

    if (state.buffer.length >= maxBuffer) {
      console.debug(`Buffer capacity reached for OKX ${instId}, dropping oldest update`);
      state.buffer.shift();
    }

    state.buffer.push({
      bids: datum.bids,
      asks: datum.asks,
      ts: Number(datum.ts) || Date.now(),
    });
  }

  /**
   * Upserts the order book entries for a specific side (bids or asks).
   *
   * @private
   * @param sideMap The side map to update.
   * @param arr The array of order book entries.
   */
  private upsertOrderBookEntries(sideMap: Map<string, number>, arr: string[][]) {
    for (const [price, sz] of arr) {
      const qty = Number(sz);

      if (!Number.isFinite(qty) || qty < 0) continue;

      if (qty === 0) sideMap.delete(price);
      else sideMap.set(price, qty);
    }
  }

  /**
   * Applies a buffered update to the order book.
   *
   * @private
   * @param state The order book state.
   * @param update The update to apply.
   */
  private applyUpdate(state: BookState, update: OkxBookMsgData) {
    this.upsertOrderBookEntries(state.bids, update.bids);
    this.upsertOrderBookEntries(state.asks, update.asks);
  }

  /**
   * Processes buffered updates after a successful resync.
   *
   * @private
   * @param state The order book state.
   * @param instId The instrument ID for logging.
   */
  private processBuffer(state: BookState, instId: string) {
    if (state.buffer.length === 0) return;

    console.debug(`Processing OKX ${state.buffer.length} buffered updates for ${instId}`);

    state.buffer.sort((a, b) => a.ts - b.ts);

    for (const update of state.buffer) {
      this.applyUpdate(state, update);
      state.lastTs = Math.max(state.lastTs || 0, update.ts);
    }

    state.buffer.length = 0;
    state.dirty = true;
  }

  /**
   * Resynchronizes the order book for a trading pair.
   *
   * @private
   * @param instId The trading instrument ID.
   * @param depthLimit The maximum depth of the order book to retrieve.
   * @returns A promise that resolves when the resynchronization is complete.
   */
  private async resync(instId: string, depthLimit?: number): Promise<void> {
    const state = this.states.get(instId);
    if (!state) return;
    state.syncing = true;

    console.debug(`Resyncing OKX order book for ${instId}...`);

    try {
      const url = `${REST_API_URL}/market/books-full?instId=${encodeURIComponent(instId)}&sz=${depthLimit ?? this.opts.depthLimit ?? DEPTH_LIMIT}`;
      const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const payload = (await resp.json()) as OkxBookRestResponse;

      if (payload.code !== '0') throw new Error(`OKX API error: ${payload.code} - ${payload.msg}`);

      const first = payload.data?.[0];
      if (!first) {
        console.warn(`No OKX order book data received for ${instId}`);
        state.syncing = false;
        return;
      }

      state.bids.clear();
      state.asks.clear();

      this.upsertOrderBookEntries(state.bids, first.bids);
      this.upsertOrderBookEntries(state.asks, first.asks);
      state.lastTs = Number(first.ts);

      // Process any buffered updates that arrived during resync
      this.processBuffer(state, instId);

      state.syncing = false;
      state.dirty = true;

      console.debug(`Successfully resynced OKX ${instId} via REST API`);
    } catch (err) {
      console.error(`Failed to resync OKX ${instId}:`, err);
      state.syncing = false;
      throw err;
    }
  }

  /**
   * Handles a WebSocket message event.
   *
   * @private
   * @param evt The raw WebSocket message event.
   * @returns
   */
  private onMessage = (evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data as string) as OkxBooksMsg;

      if (msg.event) {
        if (msg.event === 'error') console.error('OKX WebSocket error:', msg.code, msg.msg);
        return;
      }

      if (!msg.data || !msg.arg || !msg.action) return;

      const { instId } = msg.arg;
      const state = this.states.get(instId);
      if (!state) return;

      const datum = msg.data[0];
      if (!datum) return;

      const messageTs = Number(datum.ts);
      if (!Number.isFinite(messageTs)) {
        console.debug(`Invalid timestamp in message for OKX ${instId}`);
        return;
      }

      if (msg.action === 'snapshot') {
        console.debug(`Received snapshot for OKX ${instId}`);

        state.bids.clear();
        state.asks.clear();

        this.upsertOrderBookEntries(state.bids, datum.bids);
        this.upsertOrderBookEntries(state.asks, datum.asks);

        state.lastTs = messageTs;

        // Process any buffered updates after snapshot
        this.processBuffer(state, instId);

        state.syncing = false;
        state.dirty = true;
        return;
      }

      if (msg.action === 'update') {
        if (messageTs <= (state.lastTs || 0)) return;

        // If syncing, buffer the update
        if (state.syncing) {
          this.pushBuffered(state, datum, instId);
          return;
        }

        this.applyUpdate(state, datum);
        state.lastTs = messageTs;
        state.dirty = true;
        return;
      }
    } catch (err) {
      console.warn('Failed to process OKX WebSocket message', err);
    }
  };

  /**
   * Reconnects to the OKX WebSocket API.
   *
   * @private
   */
  private async reconnect() {
    console.debug('Reconnecting to OKX WebSocket...');

    this.disconnect();
    await sleep(1000);
    await this.connect();

    for (const [instId] of this.desiredArgs) this.resync(instId).catch(() => {});
  }

  /**
   * Connects to the OKX WebSocket.
   *
   * @returns {Promise<void>}
   */
  connect(): Promise<void> {
    if (this.ws || this.wsState === 'connecting' || this.wsState === 'connected')
      return Promise.resolve();

    console.debug('Connecting to OKX WebSocket...');

    const socket = new WebSocket(this.opts.socketUrl ?? SOCKET_URL);
    if (!socket) throw new Error('No WebSocket available');
    this.ws = socket;
    this.wsState = 'connecting';
    this.subscribedArgs.clear();

    return new Promise((resolve) => {
      this.ws!.onopen = () => {
        console.debug('OKX WebSocket connected');
        this.wsState = 'connected';

        const args = Array.from(this.desiredArgs.values());
        if (args.length) {
          sendWsMessage(this.ws!, { op: 'subscribe', args });
          args.forEach((a) => this.subscribedArgs.add(a.instId));
        }

        resolve();
      };

      this.ws!.onmessage = this.onMessage;

      this.ws!.onclose = async (evt: CloseEvent) => {
        console.debug('OKX WebSocket disconnected');
        this.wsState = 'disconnected';
        this.subscribedArgs.clear();
        await sleep(500 + Math.floor(Math.random() * 700));
        if (evt?.code !== 1000) this.reconnect();
      };

      this.ws!.onerror = (err) => {
        console.error('OKX WebSocket error:', err);
      };
    });
  }

  /**
   * Disconnects from the OKX WebSocket.
   *
   * @returns {void}
   */
  disconnect(): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.close(1000, 'Normal closure');
    this.wsState = 'disconnected';
    this.ws = undefined;
    this.subscribedArgs.clear();
    this.desiredArgs.clear();
    this.states.forEach((state) => (state.interval ? clearInterval(state.interval) : undefined));
    this.states.clear();
    this.listeners.clear();
    this.priceBucket = undefined;
  }

  /**
   * Watches a trading pair for book updates.
   *
   * @param instId The trading instrument ID to watch (e.g., "BTC-USDT").
   * @param depthLimit The maximum depth of the order book to retrieve.
   */
  async watchPair(instId: string, depthLimit?: number) {
    const stream = instId.toUpperCase();

    if (!this.states.has(stream))
      this.states.set(stream, {
        syncing: true,
        bids: new Map(),
        asks: new Map(),
        dirty: false,
        lastEmit: 0,
        buffer: [],
      });

    this.desiredArgs.set(stream, { channel: this.channel, instId: stream });

    await this.connect();

    console.debug(`Subscribing to OKX ${stream}...`);
    if (this.ws && this.wsState === 'connected' && !this.subscribedArgs.has(stream)) {
      sendWsMessage(this.ws, {
        op: 'subscribe',
        args: [{ channel: this.channel, instId: stream }],
      });
      this.subscribedArgs.add(stream);
    }

    const state = this.states.get(stream)!;
    if (!state.interval)
      state.interval = setInterval(() => {
        if (!state.dirty) return;
        state.dirty = false;
        state.lastEmit = Date.now();

        const book = this.getOrderBook(stream);
        if (book) emitOrderBookUpdate(this.listeners, stream, book, 'okx');
      }, this.opts.emitIntervalMs ?? EMIT_INTERVAL_MS);

    await this.resync(stream, depthLimit);
  }

  /**
   * Stops watching a trading pair for book updates.
   *
   * @param instId The trading instrument ID to unwatch (e.g., "BTC-USDT").
   */
  unwatchPair(instId: string) {
    console.debug(`Unsubscribing from OKX ${instId}...`);

    const stream = instId.toUpperCase();

    if (this.ws && this.wsState === 'connected' && this.desiredArgs.delete(stream)) {
      sendWsMessage(this.ws, {
        op: 'unsubscribe',
        args: [{ channel: this.channel, instId: stream }],
      });
      this.subscribedArgs.delete(stream);
    }
    const state = this.states.get(stream);
    if (state?.interval) clearInterval(state.interval);
    this.states.delete(stream);
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
    const key = pairKey.toUpperCase();
    const state = this.states.get(key);
    if (!state || state.syncing) return;

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
