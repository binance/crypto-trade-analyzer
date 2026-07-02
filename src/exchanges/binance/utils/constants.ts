// Spot
const REST_API_URL = 'https://data-api.binance.vision/api/v3';
const SOCKET_URL = 'wss://data-stream.binance.vision:9443/stream';
const STREAM_SPEED = '100ms' as const;
const DEPTH_LIMIT = 5000;
const MAX_BUFFERED_DIFFS = 5000;
const MAX_BUFFER_AGE_MS = 10000;

// Futures
const FUTURES_REST_API_URL = 'https://fapi.binance.com/fapi/v1';
const FUTURES_SOCKET_URL = 'wss://fstream.binance.com/stream';
const FUTURES_DEPTH_LIMIT = 1000;

export {
  REST_API_URL,
  SOCKET_URL,
  STREAM_SPEED,
  DEPTH_LIMIT,
  MAX_BUFFERED_DIFFS,
  MAX_BUFFER_AGE_MS,
  FUTURES_REST_API_URL,
  FUTURES_SOCKET_URL,
  FUTURES_DEPTH_LIMIT,
};
