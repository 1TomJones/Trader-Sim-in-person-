/**
 * Shared event + domain contracts for the trading sim.
 */

export const SIM_STATUS = {
  LOBBY: 'LOBBY',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
};

export const REGIONS = ['ASIA', 'EUROPE', 'AMERICA'];

export const RIG_CATALOG = {
  S9_LEGACY: { key: 'S9_LEGACY', name: 'S9 Legacy', purchasePrice: 1200, hashrateTHs: 14, efficiencyWPerTH: 98, resaleValuePct: 0.45 },
  S19_PRO: { key: 'S19_PRO', name: 'S19 Pro', purchasePrice: 3900, hashrateTHs: 110, efficiencyWPerTH: 30, resaleValuePct: 0.6 },
  S21_MODERN: { key: 'S21_MODERN', name: 'S21 Modern', purchasePrice: 7200, hashrateTHs: 200, efficiencyWPerTH: 17, resaleValuePct: 0.7 },
};

export const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', type: 'major', basePrice: 315, tickSize: 1 },
  { symbol: 'ETH', name: 'Ethereum', type: 'major', basePrice: 1.4, tickSize: 0.02 },
  { symbol: 'SOL', name: 'Solana', type: 'major', basePrice: 0.5, tickSize: 0.01 },
  { symbol: 'BNB', name: 'Binance Coin', type: 'major', basePrice: 0.2, tickSize: 0.01 },
  { symbol: 'XRP', name: 'XRP', type: 'major', basePrice: 0.02, tickSize: 0.001 },
  { symbol: 'DOGE', name: 'Dogecoin', type: 'meme', basePrice: 0.0002, tickSize: 0.00001 },
  { symbol: 'SHIB', name: 'Shiba Inu', type: 'meme', basePrice: 0.00000001, tickSize: 0.000000001 },
  { symbol: 'PEPE', name: 'Pepe', type: 'meme', basePrice: 0.00000001, tickSize: 0.000000001 },
  { symbol: 'FLOKI', name: 'Floki', type: 'meme', basePrice: 0.00000001, tickSize: 0.000000001 },
  { symbol: 'BONK', name: 'Bonk', type: 'meme', basePrice: 0.00000001, tickSize: 0.000000001 },
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
  ADMIN_SET_TICK_SPEED: 'adminSetTickSpeed',
  ADMIN_AUTH: 'adminAuth',
};
