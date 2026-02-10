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
  { symbol: 'BTC', name: 'Bitcoin', type: 'major', basePrice: 13, tickSize: 1 },
];

export const SERVER_EVENTS = {
  LOBBY_STATE: 'lobbyState',
  MARKET_TICK: 'marketTick',
  PLAYER_STATE: 'playerState',
  LEADERBOARD: 'leaderboard',
  NEWS_FEED_UPDATE: 'newsFeedUpdate',
  ADMIN_MARKET_STATE: 'adminMarketState',
  NEWS_EVENT_TRIGGERED: 'newsEventTriggered',
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
  ADMIN_UPDATE_MARKET: 'adminUpdateMarketParams',
  ADMIN_SET_TICK_SPEED: 'adminSetTickSpeed',
  ADMIN_AUTH: 'adminAuth',
};
