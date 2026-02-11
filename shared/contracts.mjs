export const SIM_STATUS = {
  LOBBY: 'LOBBY',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
};

export const REGIONS = ['ASIA', 'EUROPE', 'AMERICA'];

export const RIG_CATALOG = {
  AVALON_GEN1_2013: {
    key: 'AVALON_GEN1_2013',
    name: 'Avalon Gen1 (2013)',
    purchasePrice: 900,
    hashrateTHs: 0.07,
    efficiencyWPerTH: 6800,
    resaleValuePct: 0.35,
    unlockDate: '2013-01-01',
  },
  ANTMINER_S5_2014: {
    key: 'ANTMINER_S5_2014',
    name: 'Antminer S5 (2014/2015 unlock)',
    purchasePrice: 1400,
    hashrateTHs: 1.15,
    efficiencyWPerTH: 510,
    resaleValuePct: 0.45,
    unlockDate: '2014-12-01',
  },
  ANTMINER_S9_2016: {
    key: 'ANTMINER_S9_2016',
    name: 'Antminer S9 (2016 unlock)',
    purchasePrice: 2400,
    hashrateTHs: 13.5,
    efficiencyWPerTH: 98,
    resaleValuePct: 0.55,
    unlockDate: '2016-06-01',
  },
};

export const REGION_UNLOCK_FEES = {
  EUROPE: 0,
  ASIA: 1800,
  AMERICA: 2400,
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
  UNLOCK_REGION: 'unlockRegion',
  ADMIN_UPDATE_MARKET: 'adminUpdateMarketParams',
  ADMIN_SET_TICK_SPEED: 'adminSetTickSpeed',
  ADMIN_AUTH: 'adminAuth',
};
