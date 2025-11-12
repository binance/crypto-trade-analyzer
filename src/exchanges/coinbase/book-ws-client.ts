import { REST_API_URL, SOCKET_URL } from './utils/constants';
import {
  bucketizeOrderBook,
  emitOrderBookUpdate,
  sendWsMessage,
  sleep,
  withHttpRetry,
} from '../../utils/utils';
import { EMIT_INTERVAL_MS } from '../../utils/constants';
import type { OrderBook, OrderBookEntry } from '../../core/interfaces/order-book';
import type { BookWsClient, OrderBookListener } from '../../core/interfaces/book-ws-client';

/**
 * Represents a level 2 order book snapshot message.
 */
type L2SnapshotMsg = {
  type: 'snapshot';
  product_id: string;
  bids: string[][];
  asks: string[][];
};

/**
 * Represents a level 2 order book update message.
 */
type L2UpdateMsg = {
  type: 'l2update';
  product_id: string;
  time?: string;
  changes: ['buy' | 'sell', string, string][];
};

/**
 * Represents a WebSocket message.
 */
type WebsocketMsg = L2SnapshotMsg | L2UpdateMsg | { type: string; [k: string]: unknown };

/**
 * Represents the current state of the order book.
 */
type BookState = {
  syncing: boolean;
  bids: Map<string, number>;
  asks: Map<string, number>;
  buffer: L2UpdateMsg[];
  dirty: boolean;
  lastEmit: number;
  interval?: ReturnType<typeof setInterval>;
  syncTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Represents a REST API response for the Coinbase order book.
 */
export interface CoinbaseBookRestResponse {
  bids: [string, string, string?][];
  asks: [string, string, string?][];
}

/**
 * Represents the options for the Coinbase WebSocket client.
 */
export type CoinbaseBookClientOptions = {
  socketUrl?: string;
  emitIntervalMs?: number;
  maxBufferedUpdates?: number;
  resyncTimeoutMs?: number;
  resubscribeDelayMs?: number;
};

export class CoinbaseBookClient implements BookWsClient {
  private ws?: WebSocket;
  private wsState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private desiredProducts = new Set<string>();
  private subscribedProducts = new Set<string>();
  private states = new Map<string, BookState>();
  private listeners = new Set<OrderBookListener>();
  private channel = 'level2_batch';
  priceBucket: number | undefined;

  constructor(private opts: CoinbaseBookClientOptions = {}) {}

  /**
   * Upserts multiple price levels in the order book.
   *
   * @private
   * @param side The side of the book (bids or asks).
   * @param rows The price levels to update, as an array of [price, size] pairs.
   */
  private upsertRows(side: Map<string, number>, rows: string[][]) {
    for (const [p, s] of rows) {
      const size = Number(s);

      if (!Number.isFinite(size) || size < 0) continue;

      if (size === 0) side.delete(p);
      else side.set(p, size);
    }
  }

  /**
   * Applies a buffered update to the order book.
   *
   * @private
   * @param state The order book state.
   * @param update The update message to apply.
   */
  private applyUpdate(state: BookState, update: L2UpdateMsg) {
    for (const [side, p, s] of update.changes) {
      const size = Number(s);

      if (!Number.isFinite(size) || size < 0) continue;

      if (side === 'buy') {
        if (size === 0) state.bids.delete(p);
        else state.bids.set(p, size);
      } else {
        if (size === 0) state.asks.delete(p);
        else state.asks.set(p, size);
      }
    }
  }

  /**
   * Processes buffered updates after a successful resync.
   *
   * @private
   * @param state The order book state.
   */
  private processBuffer(state: BookState) {
    if (state.buffer.length === 0) return;

    console.debug(`Processing Coinbase ${state.buffer.length} buffered updates`);

    for (const update of state.buffer) this.applyUpdate(state, update);

    state.buffer.length = 0;
    state.dirty = true;
  }

  /**
   * Adds an update to the buffer with capacity management.
   *
   * @private
   * @param state The order book state.
   * @param update The update to buffer.
   * @param productId The product ID (for logging).
   */
  private bufferUpdate(state: BookState, update: L2UpdateMsg, productId: string) {
    const maxBuffer = this.opts.maxBufferedUpdates ?? 1000;

    if (state.buffer.length >= maxBuffer) {
      console.debug(`Buffer capacity reached for Coinbase ${productId}, dropping oldest update`);
      state.buffer.shift();
    }

    state.buffer.push(update);
  }

  /**
   * Attempts to resynchronize the order book state for a given product.
   *
   * The method first tries to fetch a fresh snapshot of the order book via the Coinbase REST API (fast path).
   * If the REST request fails, it falls back to forcing a fresh WebSocket snapshot by unsubscribing and re-subscribing
   * to the product's channel. If no snapshot is received within a timeout, it retries the REST snapshot.
   *
   * @private
   * @param productId - The product identifier (e.g., trading pair) to resynchronize.
   */
  private async resync(productId: string) {
    const state = this.states.get(productId);
    if (!state) return;

    state.syncing = true;
    if (state.syncTimer) {
      clearTimeout(state.syncTimer);
      state.syncTimer = undefined;
    }

    console.debug(`Resyncing Coinbase order book for ${productId}...`);

    try {
      const url = `${REST_API_URL}/products/${encodeURIComponent(productId)}/book?level=2`;
      const resp = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
      if (resp.ok) {
        const snap = (await resp.json()) as CoinbaseBookRestResponse;

        state.bids.clear();
        state.asks.clear();

        this.upsertRows(
          state.bids,
          snap.bids.map(([p, s]) => [p, s])
        );
        this.upsertRows(
          state.asks,
          snap.asks.map(([p, s]) => [p, s])
        );

        this.processBuffer(state);

        state.syncing = false;
        state.dirty = true;

        console.debug(`Successfully resynced Coinbase ${productId} via REST API`);
        return;
      }
    } catch (err) {
      console.warn(`REST resync failed for Coinbase ${productId}:`, err);
    }

    if (this.ws) {
      console.debug(`Falling back to WebSocket resync for Coinbase ${productId}`);

      sendWsMessage(this.ws, {
        type: 'unsubscribe',
        product_ids: [productId],
        channels: [this.channel],
      });
      this.subscribedProducts.delete(productId);

      // Small delay to let the server process the unsubscribe
      setTimeout(() => {
        if (!this.ws) return;

        sendWsMessage(this.ws!, {
          type: 'subscribe',
          product_ids: [productId],
          channels: [this.channel],
        });
        this.subscribedProducts.add(productId);

        state.syncTimer = setTimeout(
          () => this.resync(productId),
          this.opts.resyncTimeoutMs ?? 2000
        );
      }, this.opts.resubscribeDelayMs ?? 150);
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
      const msg = JSON.parse(evt.data as string) as WebsocketMsg;
      const type = msg.type;

      if (!type) return;

      if (type === 'snapshot') {
        const { product_id, bids, asks } = msg as L2SnapshotMsg;
        const state = this.states.get(product_id);

        if (!state) return;

        console.debug(`Received snapshot for Coinbase ${product_id}`);

        state.bids.clear();
        state.asks.clear();

        this.upsertRows(state.bids, bids);
        this.upsertRows(state.asks, asks);

        // Process any buffered updates that arrived during sync
        this.processBuffer(state);

        state.syncing = false;
        state.dirty = true;

        if (state.syncTimer) {
          clearTimeout(state.syncTimer);
          state.syncTimer = undefined;
        }

        return;
      }

      if (type === 'l2update') {
        const update = msg as L2UpdateMsg;
        const { product_id } = update;
        const state = this.states.get(product_id);

        if (!state) return;

        // If we're syncing, buffer the update instead of dropping it
        if (state.syncing) {
          this.bufferUpdate(state, update, product_id);
          return;
        }

        // Apply update directly if not syncing
        this.applyUpdate(state, update);
        state.dirty = true;
        return;
      }
    } catch (err) {
      console.warn('Failed to process Coinbase WebSocket message', err);
    }
  };

  /**
   * Reconnects to the Coinbase WebSocket.
   *
   * @private
   */
  private async reconnect() {
    console.debug('Reconnecting to Coinbase WebSocket...');

    this.disconnect();
    await sleep(1000);
    await this.connect();

    for (const [product_id] of this.desiredProducts) {
      this.resync(product_id).catch(() => {});
    }
  }

  /**
   * Connects to the Coinbase WebSocket.
   *
   * @returns {Promise<void>}
   */
  async connect(): Promise<void> {
    if (this.ws || this.wsState === 'connecting' || this.wsState === 'connected') return;

    console.debug('Connecting to Coinbase WebSocket...');

    const socket = new WebSocket(this.opts.socketUrl ?? SOCKET_URL);
    if (!socket) throw new Error('No WebSocket available');
    this.ws = socket;
    this.wsState = 'connecting';
    this.subscribedProducts.clear();

    await new Promise<void>((resolve) => {
      this.ws!.onopen = () => {
        console.debug('Coinbase WebSocket connected');
        this.wsState = 'connected';

        const products = Array.from(this.desiredProducts);
        if (products.length) {
          sendWsMessage(this.ws!, {
            type: 'subscribe',
            product_ids: products,
            channels: [this.channel],
          });
          products.forEach((p) => {
            this.subscribedProducts.add(p);
            const state = this.states.get(p);
            if (state) {
              state.syncing = true;
              if (state.syncTimer) clearTimeout(state.syncTimer);
              state.syncTimer = setTimeout(() => this.resync(p), this.opts.resyncTimeoutMs ?? 2000);
            }
          });
        }

        resolve();
      };

      this.ws!.onmessage = this.onMessage;

      this.ws!.onclose = async (evt: CloseEvent) => {
        console.debug('Coinbase WebSocket disconnected');
        this.wsState = 'disconnected';
        this.subscribedProducts.clear();
        await sleep(500 + Math.floor(Math.random() * 700));
        if (evt?.code !== 1000) this.reconnect();
      };

      this.ws!.onerror = (err) => {
        console.error('Coinbase WebSocket error:', err);
      };
    });
  }

  /**
   * Disconnects from the Coinbase WebSocket.
   *
   * @returns {void}
   */
  disconnect(): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.close(1000, 'Normal closure');
    this.wsState = 'disconnected';
    this.ws = undefined;
    this.subscribedProducts.clear();
    this.states.forEach((state) => {
      if (state.interval) clearInterval(state.interval);
      if (state.syncTimer) clearTimeout(state.syncTimer);
    });
    this.states.clear();
    this.listeners.clear();
    this.priceBucket = undefined;
  }

  /**
   * Watches a product's Level 2 book (e.g., "BTC-USD" or "BTC-USDT").
   *
   * @param productId The product ID to watch.
   */
  async watchPair(productId: string) {
    if (!this.states.has(productId))
      this.states.set(productId, {
        syncing: true,
        bids: new Map(),
        asks: new Map(),
        buffer: [],
        dirty: false,
        lastEmit: 0,
      });

    this.desiredProducts.add(productId);
    await this.connect();

    console.debug(`Subscribing to Coinbase ${productId}...`);
    if (this.ws && this.wsState === 'connected' && !this.subscribedProducts.has(productId)) {
      sendWsMessage(this.ws, {
        type: 'subscribe',
        product_ids: [productId],
        channels: [this.channel],
      });
      this.subscribedProducts.add(productId);

      const state = this.states.get(productId)!;
      state.syncing = true;
      if (state.syncTimer) clearTimeout(state.syncTimer);
      state.syncTimer = setTimeout(() => this.resync(productId), this.opts.resyncTimeoutMs ?? 2000);
    }

    const state = this.states.get(productId)!;
    if (!state.interval)
      state.interval = setInterval(() => {
        if (!state.dirty) return;
        state.dirty = false;

        const book = this.getOrderBook(productId);
        if (book) emitOrderBookUpdate(this.listeners, productId, book, 'coinbase');
      }, this.opts.emitIntervalMs ?? EMIT_INTERVAL_MS);
  }

  /**
   * Stops watching a product.
   *
   * @param productId The product ID to stop watching.
   */
  unwatchPair(productId: string) {
    console.debug(`Unsubscribing from Coinbase ${productId}...`);

    if (this.ws && this.wsState === 'connected' && this.desiredProducts.delete(productId)) {
      sendWsMessage(this.ws, {
        type: 'unsubscribe',
        product_ids: [productId],
        channels: [this.channel],
      });
      this.subscribedProducts.delete(productId);
    }

    const state = this.states.get(productId);
    if (state?.interval) clearInterval(state.interval);
    if (state?.syncTimer) clearTimeout(state.syncTimer);
    this.states.delete(productId);
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
   * Gets the current order book for a product.
   *
   * @param pairKey The product ID to retrieve the order book for.
   * @returns The current order book or undefined if not available.
   */
  getOrderBook(pairKey: string): OrderBook | undefined {
    const state = this.states.get(pairKey);
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
