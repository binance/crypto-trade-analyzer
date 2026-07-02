import { describe, it, expect } from 'vitest';
import { BybitAdapter } from '../adapter';
import { CostCalculator } from '../../../core/services/cost-calculator';
import { USDConverter } from '../../../core/services/usd-converter';
import type { BybitBookClient } from '../book-ws-client';

function makeAdapter() {
  return new BybitAdapter(new CostCalculator(new USDConverter()));
}

describe('BybitAdapter — setPriceBucket', () => {
  it('updates the adapter price bucket and the underlying WS client in sync', () => {
    const adapter = makeAdapter();
    const bookWs = (adapter as unknown as { bookWs: BybitBookClient }).bookWs;

    adapter.setPriceBucket(0.00001);
    expect(adapter.priceBucket).toBe(0.00001);
    expect(bookWs.priceBucket).toBe(0.00001);
  });

  it('clears the bucket on both when set to undefined', () => {
    const adapter = makeAdapter();
    const bookWs = (adapter as unknown as { bookWs: BybitBookClient }).bookWs;

    adapter.setPriceBucket(0.1);
    adapter.setPriceBucket(undefined);
    expect(adapter.priceBucket).toBeUndefined();
    expect(bookWs.priceBucket).toBeUndefined();
  });

  it('overrides a previously set coarse bucket with a finer one', () => {
    const adapter = makeAdapter();
    const bookWs = (adapter as unknown as { bookWs: BybitBookClient }).bookWs;

    adapter.setPriceBucket(0.1); // coarse shared maxTick grid
    adapter.setPriceBucket(0.00001); // inferred real tick
    expect(adapter.priceBucket).toBe(0.00001);
    expect(bookWs.priceBucket).toBe(0.00001);
  });
});
