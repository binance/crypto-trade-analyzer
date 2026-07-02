import type { MarketType, OrderSide, OrderSizeAsset } from '../core/interfaces/order-book';

/**
 * The shareable view state encoded into / decoded from the URL query string.
 * All fields optional on parse (a shared link may carry only some of them).
 */
export interface ShareState {
  market?: MarketType;
  pair?: string;
  side?: OrderSide;
  size?: string;
  sizeAsset?: OrderSizeAsset;
  hold?: string;
  exchanges?: string[];
}

/**
 * Parses analyzer view state from a URL query string (e.g. `window.location.search`).
 *
 * Only well-formed values are returned; unknown/invalid params are silently ignored so a
 * malformed shared link degrades gracefully to defaults rather than throwing.
 *
 * @param search - The query string, with or without a leading `?`.
 * @returns A partial ShareState containing only the valid fields present in the query.
 */
export function parseShareParams(search: string): ShareState {
  const params = new URLSearchParams(search);
  const out: ShareState = {};

  const market = params.get('m');
  if (market === 'spot' || market === 'futures') out.market = market;

  const pair = params.get('p');
  if (pair && /^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(pair))
    out.pair = pair.toUpperCase().replace('-', '/');

  const side = params.get('s');
  if (side === 'buy' || side === 'sell') out.side = side;

  const size = params.get('q');
  if (size && Number.isFinite(Number(size)) && Number(size) > 0) out.size = size;

  const sizeAsset = params.get('a');
  if (sizeAsset === 'base' || sizeAsset === 'quote') out.sizeAsset = sizeAsset;

  const hold = params.get('h');
  if (hold && Number.isFinite(Number(hold)) && Number(hold) >= 0) out.hold = hold;

  const exchanges = params.get('ex');
  if (exchanges) {
    const list = exchanges
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) out.exchanges = list;
  }

  return out;
}

/**
 * Builds an absolute, shareable URL that encodes the current analyzer view.
 *
 * The `hold` param is included only for futures (it is meaningless for spot). Exchanges are
 * joined with commas. The base is derived from the app's origin + configured base path.
 *
 * @param state - The current view state to encode.
 * @returns An absolute URL string suitable for copying/sharing.
 */
export function buildShareUrl(state: ShareState): string {
  const params = new URLSearchParams();

  if (state.market) params.set('m', state.market);
  if (state.pair) params.set('p', state.pair.replace('/', '-'));
  if (state.side) params.set('s', state.side);
  if (state.size) params.set('q', state.size);
  if (state.sizeAsset) params.set('a', state.sizeAsset);
  if (state.market === 'futures' && state.hold) params.set('h', state.hold);
  if (state.exchanges && state.exchanges.length) params.set('ex', state.exchanges.join(','));

  const base = `${window.location.origin}${import.meta.env.BASE_URL ?? '/'}`.replace(/\/+$/, '');
  const query = params.toString().replace(/%2C/gi, ',');
  return query ? `${base}/?${query}` : `${base}/`;
}
