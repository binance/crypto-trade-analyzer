import { vi } from 'vitest';

export class MockWebSocket {
  readyState = 1;
  send = vi.fn();
  close = vi.fn();
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  static current: MockWebSocket | null = null;
  constructor() {
    MockWebSocket.current = this;
  }

  feed(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  triggerOpen() {
    this.onopen?.({} as Event);
  }
}

export function stubFetchJson(payload: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }));
}
