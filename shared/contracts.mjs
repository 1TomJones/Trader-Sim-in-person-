/**
 * Shared event + domain contracts for the trading sim.
 * JSDoc typedefs keep contracts explicit across server/client.
 */

export const SIM_STATUS = {
  LOBBY: 'LOBBY',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
};

export const REGIONS = ['ASIA', 'EUROPE', 'AMERICA'];

export const RIG_CATALOG = {
  S9_LEGACY: {
    key: 'S9_LEGACY',
    name: 'S9 Legacy',
    purchasePrice: 1200,
    hashrateTHs: 14,
    efficiencyWPerTH: 98,
    resaleValuePct: 0.45,
  },
  S19_PRO: {
    key: 'S19_PRO',
    name: 'S19 Pro',
    purchasePrice: 3900,
    hashrateTHs: 110,
    efficiencyWPerTH: 30,
    resaleValuePct: 0.6,
  },
  S21_MODERN: {
    key: 'S21_MODERN',
    name: 'S21 Modern',
    purchasePrice: 7200,
    hashrateTHs: 200,
    efficiencyWPerTH: 17,
    resaleValuePct: 0.7,
  },
};

export const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', type: 'major', basePrice: 68000, tickSize: 120 },
  { symbol: 'ETH', name: 'Ethereum', type: 'major', basePrice: 3400, tickSize: 10 },
  { symbol: 'SOL', name: 'Solana', type: 'major', basePrice: 140, tickSize: 1.2 },
  { symbol: 'BNB', name: 'Binance Coin', type: 'major', basePrice: 510, tickSize: 3 },
  { symbol: 'XRP', name: 'XRP', type: 'major', basePrice: 0.62, tickSize: 0.01 },
  { symbol: 'DOGE', name: 'Dogecoin', type: 'meme', basePrice: 0.16, tickSize: 0.004 },
  { symbol: 'SHIB', name: 'Shiba Inu', type: 'meme', basePrice: 0.000023, tickSize: 0.0000008 },
  { symbol: 'PEPE', name: 'Pepe', type: 'meme', basePrice: 0.000009, tickSize: 0.0000003 },
  { symbol: 'FLOKI', name: 'Floki', type: 'meme', basePrice: 0.00019, tickSize: 0.000006 },
  { symbol: 'BONK', name: 'Bonk', type: 'meme', basePrice: 0.00003, tickSize: 0.000001 },
];

export const SERVER_EVENTS = {
  LOBBY_STATE: 'lobbyState',
  MARKET_TICK: 'marketTick',
  PLAYER_STATE: 'playerState',
  LEADERBOARD: 'leaderboard',
  NEWS_FEED_UPDATE: 'newsFeedUpdate',
  ADMIN_MARKET_STATE: 'adminMarketState',
  ERROR: 'serverError',
};

export const CLIENT_EVENTS = {
  JOIN_ROOM: 'joinRoom',
  REQUEST_START: 'requestStartSim',
  REQUEST_PAUSE: 'requestPauseSim',
  REQUEST_END: 'requestEndSim',
  BUY_CRYPTO: 'buyCrypto',
  SELL_CRYPTO: 'sellCrypto',
  BUY_RIG: 'buyRig',
  SELL_RIG: 'sellRig',
  ADMIN_CREATE_NEWS: 'adminCreateNews',
  ADMIN_UPDATE_MARKET: 'adminUpdateMarketParams',
  ADMIN_AUTH: 'adminAuth',
};
