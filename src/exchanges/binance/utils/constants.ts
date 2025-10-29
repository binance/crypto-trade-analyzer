const REST_API_URL = 'https://api.binance.com/api/v3';
const SOCKET_URL = 'wss://stream.binance.com:9443/stream';
const STREAM_SPEED = '100ms' as const;
const DEPTH_LIMIT = 5000;
const MAX_BUFFERED_DIFFS = 5000;
const MAX_BUFFER_AGE_MS = 10000;

export {
  REST_API_URL,
  SOCKET_URL,
  STREAM_SPEED,
  DEPTH_LIMIT,
  MAX_BUFFERED_DIFFS,
  MAX_BUFFER_AGE_MS,
};
