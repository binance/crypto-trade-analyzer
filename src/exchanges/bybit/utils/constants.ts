// Spot
const REST_API_URL = 'https://api.bybit.com/v5';
const SOCKET_URL = 'wss://stream.bybit.com/v5/public/spot';
const DEPTH_LIMIT = 1000;
const PING_INTERVAL_MS = 20000;
const MAX_BUFFERED_DIFFS = 2000;

// Futures
const FUTURES_SOCKET_URL = 'wss://stream.bybit.com/v5/public/linear';
const FUTURES_DEPTH_LIMIT = 200;

export {
  REST_API_URL,
  SOCKET_URL,
  DEPTH_LIMIT,
  PING_INTERVAL_MS,
  MAX_BUFFERED_DIFFS,
  FUTURES_SOCKET_URL,
  FUTURES_DEPTH_LIMIT,
};
