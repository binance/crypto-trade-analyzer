import {
  bucketizeOrderBook,
  emitOrderBookUpdate,
  sendWsMessage,
  sleep,
  withHttpRetry,
} from '../../utils/utils';
import {
  DEPTH_LIMIT,
  MAX_BUFFERED_DIFFS,
  PING_INTERVAL_MS,
  REST_API_URL,
  SOCKET_URL,
} from './utils/constants';
import { EMIT_INTERVAL_MS } from '../../utils/constants';
import type { OrderBook, OrderBookEntry } from '../../core/interfaces/order-book';
import type { BookWsClient, OrderBookListener } from '../../core/interfaces/book-ws-client';

/**
 * Bybit WebSocket order book message data structure.
 */
type BybitOrderbookMsgData = {
  s: string;
  b: string[][];
  a: string[][];
  ts?: number | string;
  u?: number;
  seq?: number;
};

/**
 * Bybit WebSocket order book message structure.
 */
type BybitOrderbookMsg = {
  topic?: string;
  type?: 'snapshot' | 'delta';
  data?: BybitOrderbookMsgData;
  op?: string;
  success?: boolean;
  retCode?: number;
  conn_id?: string;
};

/**
 * Represents a buffered order book update.
 */
type BufferedDatum = { b: string[][]; a: string[][]; seq?: number; u?: number; ts?: number };

/**
 * Bybit WebSocket order book message data structure.
 */
type BookState = {
  bids: Map<string, number>;
  asks: Map<string, number>;
  dirty: boolean;
  lastEmit: number;
  syncing: boolean;
  lastSeq?: number;
  buffer: BufferedDatum[];
  interval?: ReturnType<typeof setInterval>;
};

/**
 * Bybit WebSocket order book message data structure.
 */
export interface BybitBookRestResponse {
  retCode: number;
  result?: BybitOrderbookMsgData;
}

/**
 * Bybit WebSocket order book client options.
 */
export type BybitBookClientOptions = {
  socketUrl?: string;
  depthLimit?: number;
  emitIntervalMs?: number;
  maxBufferedDiffs?: number;
};

export class BybitBookClient implements BookWsClient {
  private ws?: WebSocket;
  private wsState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private desiredTopics = new Set<string>();
  private subscribedTopics = new Set<string>();
  private states = new Map<string, BookState>();
  private listeners = new Set<OrderBookListener>();
  private pingTimer?: ReturnType<typeof setInterval>;
  priceBucket: number | undefined;

  constructor(private opts: BybitBookClientOptions = {}) {}

  /**
   * Pushes a new order book update to the buffer with capacity management.
   *
   * @private
   * @param state The current state of the order book.
   * @param data The new order book update data.
   * @param symbol The symbol for logging.
   */
  private pushBuffered(state: BookState, data: NonNullable<BybitOrderbookMsgData>, symbol: string) {
    const cap = this.opts.maxBufferedDiffs ?? MAX_BUFFERED_DIFFS;

    if (state.buffer.length >= cap) {
      console.debug(`Buffer capacity reached for Bybit ${symbol}, dropping oldest update`);
      state.buffer.shift();
    }

    state.buffer.push({
      b: data.b,
      a: data.a,
      seq: data.seq,
      u: data.u,
      ts: Number(data.ts) || Date.now(),
    });
  }

  /**
   * Extracts the trading pair symbol from a WebSocket topic string.
   *
   * @private
   * @param topic The WebSocket topic string (e.g., "orderbook.200.BTCUSDT").
   * @returns The trading pair symbol (e.g., "BTCUSDT") or undefined if not found.
   */
  private symbolFromTopic(topic?: string): string | undefined {
    if (!topic) return;
    return topic.split('.')[2]?.toUpperCase();
  }

  /**
   * Updates the order book entries for a specific side (bids or asks).
   *
   * @private
   * @param side The side of the order book to update (bids or asks).
   * @param rows The new order book entries to insert/update.
   */
  private upsertOrderBookEntries(side: Map<string, number>, rows: string[][]) {
    for (const [priceStr, sizeStr] of rows) {
      const price = Number(priceStr);
      const qty = Number(sizeStr);

      if (!Number.isFinite(price) || !Number.isFinite(qty) || price < 0 || qty < 0) continue;

      if (qty === 0) side.delete(priceStr);
      else side.set(priceStr, qty);
    }
  }

  /**
   * Applies a buffered update to the order book.
   *
   * @private
   * @param state The order book state.
   * @param update The update to apply.
   */
  private applyUpdate(state: BookState, update: BufferedDatum) {
    this.upsertOrderBookEntries(state.bids, update.b);
    this.upsertOrderBookEntries(state.asks, update.a);
    if (update.seq != null) state.lastSeq = update.seq;
  }

  /**
   * Processes buffered updates with sequence validation.
   *
   * @private
   * @param state The order book state.
   * @param symbol The symbol for logging.
   */
  private processBuffer(state: BookState, symbol: string) {
    if (state.buffer.length === 0) return;

    console.debug(`Processing ${state.buffer.length} buffered updates for Bybit ${symbol}`);

    state.buffer.sort((x, y) => {
      const seqX = x.seq;
      const seqY = y.seq;

      // If both have sequence numbers, use them
      if (seqX != null && seqY != null) return seqX - seqY;

      // Fall back to timestamp
      const tsX = x.ts ?? 0;
      const tsY = y.ts ?? 0;
      return tsX - tsY;
    });

    // Process updates with sequence validation
    for (const update of state.buffer) {
      if (update.seq != null && state.lastSeq != null && update.seq <= state.lastSeq) continue;

      this.applyUpdate(state, update);
    }

    state.buffer.length = 0;
    state.dirty = true;
  }

  /**
   * Resynchronizes the order book for a trading pair.
   *
   * @private
   * @param symbol The trading pair key.
   * @param depthLimit The maximum depth of the order book to retrieve.
   * @returns A promise that resolves when the resynchronization is complete.
   */
  private async resync(symbol: string, limit?: number) {
    const state = this.states.get(symbol);
    if (!state) return;
    state.syncing = true;

    console.debug(`Resyncing order book for Bybit ${symbol}...`);

    try {
      const url = `${REST_API_URL}/market/orderbook?category=spot&symbol=${encodeURIComponent(symbol)}&limit=${limit ?? this.opts.depthLimit ?? DEPTH_LIMIT}`;
      const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 5 });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const payload = (await resp.json()) as BybitBookRestResponse;

      if (payload.retCode !== 0) throw new Error(`Bybit API error: ${payload.retCode}`);

      const res = payload.result;
      if (!res) {
        console.warn(`No Bybit order book data received for ${symbol}`);
        state.syncing = false;
        return;
      }

      state.bids.clear();
      state.asks.clear();

      this.upsertOrderBookEntries(state.bids, res.b);
      this.upsertOrderBookEntries(state.asks, res.a);

      // Reset sequence tracking after snapshot
      if (res.seq != null) state.lastSeq = res.seq;
      else state.lastSeq = undefined;

      this.processBuffer(state, symbol);

      state.syncing = false;
      state.dirty = true;

      console.debug(`Successfully resynced Bybit ${symbol} via REST API`);
    } catch (err) {
      console.error(`Failed to resync Bybit ${symbol}:`, err);
      state.syncing = false;
      throw err;
    }
  }

  /**
   * Handles incoming WebSocket message.
   *
   * @private
   * @param evt The WebSocket message event.
   * @returns
   */
  private onMessage = (evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data as string) as BybitOrderbookMsg;

      if (msg.op && msg.success !== undefined) {
        if (!msg.success) console.error('Bybit subscription failed:', msg.retCode);
        return;
      }

      if (!msg.topic || !msg.data || !msg.type) return;
      if (!msg.topic.startsWith('orderbook.')) return;

      const symbol = this.symbolFromTopic(msg.topic);
      if (!symbol) return;

      const state = this.states.get(symbol);
      if (!state) return;

      if (msg.type === 'snapshot') {
        state.bids.clear();
        state.asks.clear();

        this.upsertOrderBookEntries(state.bids, msg.data.b);
        this.upsertOrderBookEntries(state.asks, msg.data.a);

        if (msg.data.seq != null) state.lastSeq = msg.data.seq;

        this.processBuffer(state, symbol);

        state.syncing = false;
        state.dirty = true;
        return;
      }

      if (msg.type === 'delta') {
        if (msg.data.seq != null && state.lastSeq != null && msg.data.seq <= state.lastSeq) return;

        if (state.syncing) {
          this.pushBuffered(state, msg.data, symbol);
          return;
        }

        this.upsertOrderBookEntries(state.bids, msg.data.b);
        this.upsertOrderBookEntries(state.asks, msg.data.a);

        if (msg.data.seq != null) state.lastSeq = msg.data.seq;

        state.dirty = true;
        return;
      }
    } catch (err) {
      console.warn('Failed to process Bybit WebSocket message', err);
    }
  };

  /**
   * Reconnects to the Bybit WebSocket.
   *
   * @private
   */
  private async reconnect() {
    console.debug('Reconnecting to Bybit WebSocket...');

    this.disconnect();
    await sleep(1000);
    await this.connect();

    for (const topic of Array.from(this.desiredTopics)) {
      const symbol = this.symbolFromTopic(topic);
      if (symbol) this.resync(symbol).catch(() => {});
    }
  }

  /**
   * Connects to the Bybit WebSocket.
   *
   * @returns {Promise<void>}
   */
  async connect(): Promise<void> {
    if (this.ws || this.wsState === 'connecting' || this.wsState === 'connected') return;

    console.debug('Connecting to Bybit WebSocket...');

    const socket = new WebSocket(this.opts.socketUrl ?? SOCKET_URL);
    if (!socket) throw new Error('No WebSocket available');
    this.ws = socket;
    this.wsState = 'connecting';
    this.subscribedTopics.clear();

    await new Promise<void>((resolve) => {
      this.ws!.onopen = () => {
        console.debug('Bybit WebSocket connected');
        this.wsState = 'connected';

        const args = Array.from(this.desiredTopics);
        if (args.length) {
          sendWsMessage(this.ws!, { op: 'subscribe', args });
          args.forEach((arg) => this.subscribedTopics.add(arg));
        }

        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN)
            sendWsMessage(this.ws, { op: 'ping' });
        }, PING_INTERVAL_MS);

        resolve();
      };

      this.ws!.onmessage = this.onMessage;

      this.ws!.onclose = async (evt: CloseEvent) => {
        console.debug('Bybit WebSocket disconnected');
        this.wsState = 'disconnected';
        this.subscribedTopics.clear();

        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = undefined;
        }

        await sleep(500 + Math.floor(Math.random() * 700));
        if (evt?.code !== 1000) this.reconnect();
      };

      this.ws!.onerror = (err) => {
        console.error('Bybit WebSocket error:', err);
      };
    });
  }

  /**
   * Disconnects from the Bybit WebSocket.
   *
   * @returns {void}
   */
  disconnect(): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.close(1000, 'Normal closure');
    this.wsState = 'disconnected';
    this.ws = undefined;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.states.forEach((state) => (state.interval ? clearInterval(state.interval) : undefined));
    this.subscribedTopics.clear();
    this.desiredTopics.clear();
    this.states.clear();
    this.listeners.clear();
    this.priceBucket = undefined;
    this.pingTimer = undefined;
  }

  /**
   * Watches a trading pair's order book.
   *
   * @param symbol The trading pair symbol (e.g., "BTCUSDT").
   * @param depth The depth of the order book to subscribe to.
   */
  async watchPair(symbol: string, depth?: number) {
    const normalizedSymbol = symbol.toUpperCase();
    const sz = depth ?? this.opts.depthLimit ?? DEPTH_LIMIT;
    const topic = `orderbook.${sz}.${normalizedSymbol}`;

    if (!this.states.has(normalizedSymbol))
      this.states.set(normalizedSymbol, {
        bids: new Map(),
        asks: new Map(),
        dirty: false,
        lastEmit: 0,
        syncing: true,
        lastSeq: undefined,
        buffer: [],
      });

    this.desiredTopics.add(topic);

    await this.connect();

    console.debug(`Subscribing to Bybit ${topic}...`);
    if (this.ws && this.wsState === 'connected' && !this.subscribedTopics.has(topic)) {
      sendWsMessage(this.ws, { op: 'subscribe', args: [topic] });
      this.subscribedTopics.add(topic);
    }

    const state = this.states.get(normalizedSymbol)!;
    if (!state.interval) {
      state.interval = setInterval(() => {
        if (!state.dirty) return;
        state.dirty = false;
        state.lastEmit = Date.now();

        const book = this.getOrderBook(normalizedSymbol);
        if (book) emitOrderBookUpdate(this.listeners, normalizedSymbol, book, 'bybit');
      }, this.opts.emitIntervalMs ?? EMIT_INTERVAL_MS);
    }

    await this.resync(normalizedSymbol, sz);
  }

  /**
   * Unsubscribes from a trading pair's order book.
   *
   * @param symbol The trading pair symbol (e.g., "BTCUSDT").
   */
  unwatchPair(symbol: string) {
    const normalizedSymbol = symbol.toUpperCase();
    console.debug(`Unsubscribing from Bybit ${normalizedSymbol}...`);

    for (const topic of Array.from(this.desiredTopics)) {
      if (
        this.wsState === 'connected' &&
        this.ws &&
        topic.endsWith(`.${normalizedSymbol}`) &&
        this.desiredTopics.delete(topic)
      ) {
        sendWsMessage(this.ws, { op: 'unsubscribe', args: [topic] });
        this.subscribedTopics.delete(topic);
        this.priceBucket = undefined;
      }
    }

    const state = this.states.get(normalizedSymbol);
    if (state?.interval) clearInterval(state.interval);
    this.states.delete(normalizedSymbol);
  }

  /**
   * Adds a listener for order book updates.
   *
   * @param cb The listener callback.
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
