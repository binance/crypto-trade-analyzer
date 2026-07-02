import { describe, it, expect, beforeAll, vi } from 'vitest';
import { parseShareParams, buildShareUrl } from '../share-url';

describe('parseShareParams', () => {
  it('returns empty object for empty string', () => {
    expect(parseShareParams('')).toEqual({});
  });

  it('parses all valid fields', () => {
    const result = parseShareParams(
      '?m=futures&p=XLM-USDT&s=buy&q=1000&a=quote&h=8&ex=Binance,OKX'
    );
    expect(result).toEqual({
      market: 'futures',
      pair: 'XLM/USDT',
      side: 'buy',
      size: '1000',
      sizeAsset: 'quote',
      hold: '8',
      exchanges: ['Binance', 'OKX'],
    });
  });

  it('accepts spot market', () => {
    expect(parseShareParams('?m=spot').market).toBe('spot');
  });

  it('ignores invalid market', () => {
    expect(parseShareParams('?m=options').market).toBeUndefined();
  });

  it('uppercases the pair and converts dash to slash', () => {
    expect(parseShareParams('?p=btc-usdt').pair).toBe('BTC/USDT');
  });

  it('rejects pair without dash', () => {
    expect(parseShareParams('?p=BTCUSDT').pair).toBeUndefined();
  });

  it('rejects pair with special characters', () => {
    expect(parseShareParams('?p=BTC-USD$').pair).toBeUndefined();
  });

  it('accepts both side values', () => {
    expect(parseShareParams('?s=sell').side).toBe('sell');
    expect(parseShareParams('?s=buy').side).toBe('buy');
  });

  it('ignores invalid side', () => {
    expect(parseShareParams('?s=long').side).toBeUndefined();
  });

  it('rejects non-numeric size', () => {
    expect(parseShareParams('?q=abc').size).toBeUndefined();
  });

  it('rejects zero or negative size', () => {
    expect(parseShareParams('?q=0').size).toBeUndefined();
    expect(parseShareParams('?q=-10').size).toBeUndefined();
  });

  it('accepts base and quote sizeAsset', () => {
    expect(parseShareParams('?a=base').sizeAsset).toBe('base');
    expect(parseShareParams('?a=quote').sizeAsset).toBe('quote');
  });

  it('ignores invalid sizeAsset', () => {
    expect(parseShareParams('?a=usd').sizeAsset).toBeUndefined();
  });

  it('accepts zero hold (open position)', () => {
    expect(parseShareParams('?h=0').hold).toBe('0');
  });

  it('rejects negative hold', () => {
    expect(parseShareParams('?h=-1').hold).toBeUndefined();
  });

  it('splits exchanges on comma and trims whitespace', () => {
    expect(parseShareParams('?ex=Binance, Bybit , OKX').exchanges).toEqual([
      'Binance',
      'Bybit',
      'OKX',
    ]);
  });

  it('ignores empty exchanges param', () => {
    expect(parseShareParams('?ex=').exchanges).toBeUndefined();
  });

  it('returns only valid fields when some are invalid', () => {
    const result = parseShareParams('?m=options&s=buy&q=-5&p=BTC-USDT');
    expect(result.market).toBeUndefined();
    expect(result.side).toBe('buy');
    expect(result.size).toBeUndefined();
    expect(result.pair).toBe('BTC/USDT');
  });
});

describe('buildShareUrl', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { location: { origin: 'https://example.com' } });
  });

  it('builds a URL with all fields for futures', () => {
    const url = buildShareUrl({
      market: 'futures',
      pair: 'XLM/USDT',
      side: 'sell',
      size: '500',
      sizeAsset: 'base',
      hold: '24',
      exchanges: ['Binance', 'OKX'],
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('m')).toBe('futures');
    expect(parsed.searchParams.get('p')).toBe('XLM-USDT');
    expect(parsed.searchParams.get('s')).toBe('sell');
    expect(parsed.searchParams.get('q')).toBe('500');
    expect(parsed.searchParams.get('a')).toBe('base');
    expect(parsed.searchParams.get('h')).toBe('24');
    expect(parsed.searchParams.get('ex')).toBe('Binance,OKX');
  });

  it('omits hold for spot market', () => {
    const url = buildShareUrl({
      market: 'spot',
      pair: 'BTC/USDT',
      side: 'buy',
      size: '1000',
      sizeAsset: 'quote',
      hold: '8',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('h')).toBeNull();
  });

  it('omits hold when market is undefined', () => {
    const url = buildShareUrl({ hold: '8' });
    expect(url).not.toContain('h=');
  });

  it('round-trips through parse', () => {
    const state = {
      market: 'futures' as const,
      pair: 'ETH/USDT',
      side: 'buy' as const,
      size: '250',
      sizeAsset: 'quote' as const,
      hold: '4',
      exchanges: ['Bybit', 'Coinbase'],
    };
    const url = buildShareUrl(state);
    const parsed = parseShareParams(new URL(url).search);
    expect(parsed).toEqual(state);
  });

  it('round-trips spot state — hold is excluded from URL and does not come back', () => {
    const state = {
      market: 'spot' as const,
      pair: 'BTC/USDT',
      side: 'sell' as const,
      size: '0.5',
      sizeAsset: 'base' as const,
      hold: '24',
      exchanges: ['Binance', 'Bybit'],
    };
    const parsed = parseShareParams(new URL(buildShareUrl(state)).search);
    expect(parsed.market).toBe('spot');
    expect(parsed.pair).toBe('BTC/USDT');
    expect(parsed.side).toBe('sell');
    expect(parsed.size).toBe('0.5');
    expect(parsed.sizeAsset).toBe('base');
    expect(parsed.hold).toBeUndefined();
    expect(parsed.exchanges).toEqual(['Binance', 'Bybit']);
  });

  it('round-trips partial state — only provided fields survive reload', () => {
    const state = { market: 'futures' as const, pair: 'ETH/USDT', side: 'buy' as const };
    const parsed = parseShareParams(new URL(buildShareUrl(state)).search);
    expect(parsed.market).toBe('futures');
    expect(parsed.pair).toBe('ETH/USDT');
    expect(parsed.side).toBe('buy');
    expect(parsed.size).toBeUndefined();
    expect(parsed.sizeAsset).toBeUndefined();
    expect(parsed.hold).toBeUndefined();
    expect(parsed.exchanges).toBeUndefined();
  });

  it('omits exchanges from URL when array is empty, parses back to undefined', () => {
    const url = buildShareUrl({ market: 'spot', exchanges: [] });
    expect(url).not.toContain('ex=');
    expect(parseShareParams(new URL(url).search).exchanges).toBeUndefined();
  });

  it('returns a base URL with trailing slash when state is empty', () => {
    const url = buildShareUrl({});
    expect(url).toMatch(/\/$/);
    expect(url).not.toContain('?');
  });

  it('omits undefined/empty fields', () => {
    const url = buildShareUrl({ market: 'spot', pair: 'BTC/USDT' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('s')).toBeNull();
    expect(parsed.searchParams.get('q')).toBeNull();
    expect(parsed.searchParams.get('ex')).toBeNull();
  });
});
