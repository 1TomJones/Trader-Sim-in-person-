import crypto from 'crypto';
import { ASSETS, REGIONS, RIG_CATALOG, SIM_STATUS } from '../shared/contracts.mjs';

const TICK_MS = 1000;
const STARTING_CASH = 100000;
const ROOM_ID = 'MAIN';
const BLOCKS_PER_TICK = 1 / 600; // ~10 min blocks
const BLOCK_REWARD_BTC = 3.125;
const NETWORK_HASHRATE_THS = 750_000_000;

const defaultEnergy = {
  ASIA: 0.11,
  EUROPE: 0.18,
  AMERICA: 0.13,
};

const uuid = () => crypto.randomUUID();
const clamp = (v, min) => Math.max(min, v);

export class SimEngine {
  constructor(db) {
    this.db = db;
    this.state = {
      roomId: ROOM_ID,
      status: SIM_STATUS.LOBBY,
      startedAt: null,
      tick: 0,
    };
    this.players = new Map();
    this.socketToPlayer = new Map();
    this.market = new Map(ASSETS.map((a) => [a.symbol, { ...a, lastPrice: a.basePrice, previousPrice: a.basePrice, biasDirection: null, biasStrength: 0.5, biasUntil: 0, updatedAt: Date.now() }]));
    this.energy = { ...defaultEnergy };
    this.energyBiases = []; // {region, delta, until}
    this.news = [];
    this.adminLog = [];
    this.rate = new Map();
    this.persistMarket();
  }

  addPlayer({ socketId, name }) {
    let pid = this.socketToPlayer.get(socketId);
    if (pid && this.players.has(pid)) {
      this.players.get(pid).socketId = socketId;
      return this.players.get(pid);
    }
    const id = uuid();
    const createdAt = Date.now();
    const player = {
      id, socketId, name: String(name || 'Player').slice(0, 24), roomId: ROOM_ID, createdAt,
      cashUSD: STARTING_CASH,
      startingCash: STARTING_CASH,
      holdings: Object.fromEntries(ASSETS.map((a) => [a.symbol, { qty: 0, avgEntry: 0 }])),
      rigs: [],
    };
    this.players.set(id, player);
    this.socketToPlayer.set(socketId, id);
    this.db.prepare('INSERT INTO players(id,name,roomId,createdAt,startingCash) VALUES (?,?,?,?,?)').run(id, player.name, ROOM_ID, createdAt, STARTING_CASH);
    this.db.prepare('INSERT INTO wallets(playerId,cashUSD) VALUES(?,?)').run(id, STARTING_CASH);
    return player;
  }

  reconnect({ socketId, playerId }) {
    const p = this.players.get(playerId);
    if (!p) return null;
    p.socketId = socketId;
    this.socketToPlayer.set(socketId, playerId);
    return p;
  }

  removeSocket(socketId) {
    this.socketToPlayer.delete(socketId);
  }

  getPlayerBySocket(socketId) {
    const id = this.socketToPlayer.get(socketId);
    return id ? this.players.get(id) : null;
  }

  assertRate(playerId, action) {
    const now = Date.now();
    const key = `${playerId}:${action}`;
    const arr = this.rate.get(key) || [];
    const recent = arr.filter((t) => now - t < 1000);
    if (recent.length >= 5) return false;
    recent.push(now);
    this.rate.set(key, recent);
    return true;
  }

  start() {
    if (this.state.status === SIM_STATUS.RUNNING) return;
    this.state.status = SIM_STATUS.RUNNING;
    this.state.startedAt = this.state.startedAt || Date.now();
    this.persistSimState();
    this.logAdmin('Sim started');
  }
  pause() {
    if (this.state.status !== SIM_STATUS.RUNNING) return;
    this.state.status = SIM_STATUS.PAUSED;
    this.persistSimState();
    this.logAdmin('Sim paused');
  }
  end() {
    this.state.status = SIM_STATUS.ENDED;
    this.persistSimState();
    this.logAdmin('Sim ended');
  }

  stepTick() {
    if (this.state.status !== SIM_STATUS.RUNNING) return;
    this.state.tick += 1;
    const now = Date.now();
    this.applyEnergyBiases(now);

    for (const asset of this.market.values()) {
      const biasActive = asset.biasUntil > now;
      const upProb = biasActive
        ? (asset.biasDirection === 'UP' ? asset.biasStrength : 1 - asset.biasStrength)
        : 0.5;
      const up = Math.random() < upProb;
      asset.previousPrice = asset.lastPrice;
      asset.lastPrice = clamp(asset.lastPrice + (up ? asset.tickSize : -asset.tickSize), asset.tickSize);
      asset.updatedAt = now;
    }

    for (const p of this.players.values()) this.applyMiningForPlayer(p);
    this.persistWalletsAndHoldings();
    if (this.state.tick % 10 === 0) this.persistSnapshot();
    this.persistMarket();
    this.persistSimState();
  }

  applyMiningForPlayer(player) {
    let minedBTC = 0;
    let energyCost = 0;
    const hoursPerTick = TICK_MS / 1000 / 3600;
    for (const rig of player.rigs) {
      const share = rig.hashrateTHs / NETWORK_HASHRATE_THS;
      minedBTC += share * BLOCKS_PER_TICK * BLOCK_REWARD_BTC;
      const powerW = rig.hashrateTHs * rig.efficiencyWPerTH;
      energyCost += (powerW / 1000) * hoursPerTick * (this.energy[rig.region] ?? 0.12);
    }
    if (minedBTC > 0) {
      const h = player.holdings.BTC;
      const oldValue = h.qty * h.avgEntry;
      const price = this.market.get('BTC').lastPrice;
      h.qty += minedBTC;
      h.avgEntry = h.qty === 0 ? 0 : (oldValue + minedBTC * price) / h.qty;
    }
    if (energyCost > 0) {
      player.cashUSD -= energyCost;
      this.db.prepare('INSERT INTO cost_ledger(id,playerId,type,amountUSD,timestamp) VALUES(?,?,?,?,?)').run(uuid(), player.id, 'ENERGY', Number(energyCost.toFixed(6)), Date.now());
    }
  }

  buyCrypto(player, symbol, qty) {
    if (this.state.status !== SIM_STATUS.RUNNING) return { ok: false, message: 'Simulation not running' };
    if (!this.assertRate(player.id, 'trade')) return { ok: false, message: 'Rate limit exceeded' };
    qty = Number(qty);
    if (!(qty > 0)) return { ok: false, message: 'Invalid quantity' };
    const asset = this.market.get(symbol);
    if (!asset) return { ok: false, message: 'Unknown asset' };
    const cost = qty * asset.lastPrice;
    if (player.cashUSD <= 0 || player.cashUSD - cost < 0) return { ok: false, message: 'Insufficient cash' };
    const h = player.holdings[symbol];
    const oldValue = h.qty * h.avgEntry;
    h.qty += qty;
    h.avgEntry = (oldValue + cost) / h.qty;
    player.cashUSD -= cost;
    this.recordTrade(player.id, symbol, 'BUY', qty, asset.lastPrice);
    return { ok: true };
  }

  sellCrypto(player, symbol, qty) {
    if (this.state.status !== SIM_STATUS.RUNNING) return { ok: false, message: 'Simulation not running' };
    if (!this.assertRate(player.id, 'trade')) return { ok: false, message: 'Rate limit exceeded' };
    qty = Number(qty);
    const asset = this.market.get(symbol);
    if (!(qty > 0) || !asset) return { ok: false, message: 'Invalid request' };
    const h = player.holdings[symbol];
    if (qty > h.qty) return { ok: false, message: 'Not enough holdings' };
    h.qty -= qty;
    if (h.qty <= 0) { h.qty = 0; h.avgEntry = 0; }
    player.cashUSD += qty * asset.lastPrice;
    this.recordTrade(player.id, symbol, 'SELL', qty, asset.lastPrice);
    return { ok: true };
  }

  buyRig(player, region, rigType, count = 1) {
    if (this.state.status !== SIM_STATUS.RUNNING) return { ok: false, message: 'Simulation not running' };
    if (!this.assertRate(player.id, 'rig')) return { ok: false, message: 'Rate limit exceeded' };
    const rig = RIG_CATALOG[rigType];
    count = Math.max(1, Math.floor(Number(count) || 1));
    if (!rig || !REGIONS.includes(region)) return { ok: false, message: 'Invalid rig request' };
    const totalCost = rig.purchasePrice * count;
    if (player.cashUSD <= 0 || player.cashUSD - totalCost < 0) return { ok: false, message: 'Insufficient cash' };
    for (let i = 0; i < count; i += 1) {
      const r = { id: uuid(), playerId: player.id, region, rigType: rig.key, ...rig, createdAt: Date.now() };
      player.rigs.push(r);
      this.db.prepare('INSERT INTO mining_rigs(id,playerId,region,rigType,purchasePrice,hashrateTHs,efficiencyWPerTH,resaleValuePct,createdAt) VALUES (?,?,?,?,?,?,?,?,?)').run(r.id, r.playerId, r.region, r.rigType, r.purchasePrice, r.hashrateTHs, r.efficiencyWPerTH, r.resaleValuePct, r.createdAt);
    }
    player.cashUSD -= totalCost;
    return { ok: true };
  }

  sellRig(player, payload) {
    if (!this.assertRate(player.id, 'rig')) return { ok: false, message: 'Rate limit exceeded' };
    const { rigId, region, rigType, count = 1 } = payload || {};
    let targets = [];
    if (rigId) targets = player.rigs.filter((r) => r.id === rigId);
    else {
      targets = player.rigs.filter((r) => (!region || r.region === region) && (!rigType || r.rigType === rigType)).slice(0, Math.max(1, Number(count) || 1));
    }
    if (!targets.length) return { ok: false, message: 'No rigs selected' };
    for (const rig of targets) {
      player.cashUSD += rig.purchasePrice * rig.resaleValuePct;
      player.rigs = player.rigs.filter((r) => r.id !== rig.id);
      this.db.prepare('DELETE FROM mining_rigs WHERE id = ?').run(rig.id);
    }
    return { ok: true };
  }

  createNews(payload) {
    const event = {
      id: uuid(),
      timestamp: Date.now(),
      headline: String(payload.headline || 'Untitled').slice(0, 120),
      body: String(payload.body || '').slice(0, 500),
      tags: payload.tags || [],
      affectedAssets: payload.affectedAssets || [],
      biasConfig: payload.biasConfig || null,
      energyConfig: payload.energyConfig || null,
      durationSec: Number(payload.durationSec || 120),
      severity: payload.severity || 'MEDIUM',
    };
    this.news.unshift(event);
    this.news = this.news.slice(0, 100);
    const until = Date.now() + event.durationSec * 1000;
    if (event.biasConfig) {
      const { direction = 'UP', strength = 0.65 } = event.biasConfig;
      for (const sym of event.affectedAssets) {
        const m = this.market.get(sym);
        if (m) {
          m.biasDirection = direction;
          m.biasStrength = Math.min(0.95, Math.max(0.51, Number(strength) || 0.65));
          m.biasUntil = until;
        }
      }
    }
    if (event.energyConfig?.changes) {
      for (const change of event.energyConfig.changes) {
        this.energyBiases.push({ region: change.region, delta: Number(change.delta || 0), until });
      }
    }
    this.db.prepare('INSERT INTO news_events(id,timestamp,headline,body,tags,affectedAssets,biasConfig,energyConfig,durationSec,severity) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      event.id, event.timestamp, event.headline, event.body, JSON.stringify(event.tags), JSON.stringify(event.affectedAssets), JSON.stringify(event.biasConfig), JSON.stringify(event.energyConfig), event.durationSec, event.severity,
    );
    this.logAdmin(`News created: ${event.headline}`);
    return event;
  }

  updateMarketParams(payload) {
    for (const row of payload?.assets || []) {
      const m = this.market.get(row.symbol);
      if (!m) continue;
      if (Number(row.tickSize) > 0) m.tickSize = Number(row.tickSize);
      if (row.manualBias) {
        m.biasDirection = row.manualBias.direction;
        m.biasStrength = Number(row.manualBias.strength || 0.6);
        m.biasUntil = Date.now() + Number(row.manualBias.durationSec || 120) * 1000;
      }
      if (row.resetBias) {
        m.biasDirection = null;
        m.biasStrength = 0.5;
        m.biasUntil = 0;
      }
    }
    for (const e of payload?.energy || []) if (REGIONS.includes(e.region) && Number(e.energyPriceUSD) > 0) this.energy[e.region] = Number(e.energyPriceUSD);
    this.logAdmin('Market params updated');
  }

  applyEnergyBiases(now = Date.now()) {
    this.energy = { ...defaultEnergy };
    this.energyBiases = this.energyBiases.filter((b) => b.until > now);
    for (const b of this.energyBiases) this.energy[b.region] = Math.max(0.02, this.energy[b.region] + b.delta);
  }

  recordTrade(playerId, symbol, side, qty, fillPrice) {
    this.db.prepare('INSERT INTO trades(id,playerId,symbol,side,qty,fillPrice,feeUSD,timestamp) VALUES (?,?,?,?,?,?,?,?)').run(uuid(), playerId, symbol, side, qty, fillPrice, 0, Date.now());
  }

  netWorth(player) {
    const holdingsValue = Object.entries(player.holdings).reduce((sum, [symbol, h]) => sum + h.qty * this.market.get(symbol).lastPrice, 0);
    const rigValue = player.rigs.reduce((sum, r) => sum + r.purchasePrice * r.resaleValuePct, 0);
    return player.cashUSD + holdingsValue + rigValue;
  }

  leaderboard() {
    return [...this.players.values()].map((p) => {
      const netWorth = this.netWorth(p);
      return {
        playerId: p.id,
        name: p.name,
        cash: Number(p.cashUSD.toFixed(2)),
        netWorth: Number(netWorth.toFixed(2)),
        pnl: Number((netWorth - p.startingCash).toFixed(2)),
      };
    }).sort((a, b) => b.pnl - a.pnl);
  }

  positionsSummary() {
    const rows = [...this.players.values()].map((p) => ({
      name: p.name,
      btcQty: p.holdings.BTC.qty,
      memeQty: ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK'].reduce((s, sym) => s + (p.holdings[sym]?.qty || 0), 0),
      rigs: p.rigs.length,
    })).sort((a, b) => b.btcQty - a.btcQty);
    const totalRigsByRegion = REGIONS.reduce((acc, r) => ({ ...acc, [r]: 0 }), {});
    for (const p of this.players.values()) for (const rig of p.rigs) totalRigsByRegion[rig.region] += 1;
    const totalCash = [...this.players.values()].reduce((s, p) => s + p.cashUSD, 0);
    return { rows: rows.slice(0, 10), totalRigsByRegion, totalCash: Number(totalCash.toFixed(2)) };
  }

  playerView(player) {
    return {
      id: player.id,
      name: player.name,
      cash: Number(player.cashUSD.toFixed(2)),
      holdings: player.holdings,
      rigs: player.rigs,
      netWorth: Number(this.netWorth(player).toFixed(2)),
      pnl: Number((this.netWorth(player) - player.startingCash).toFixed(2)),
    };
  }

  marketView() {
    return {
      time: Date.now(),
      prices: Object.fromEntries([...this.market.entries()].map(([k, v]) => [k, { price: v.lastPrice, previous: v.previousPrice, type: v.type }])),
      activeBiases: [...this.market.values()].filter((m) => m.biasUntil > Date.now()).map((m) => ({ symbol: m.symbol, direction: m.biasDirection, strength: m.biasStrength, until: m.biasUntil })),
    };
  }

  lobbyView() {
    return { players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name })), status: this.state.status };
  }

  adminMarketState() {
    return {
      perAsset: [...this.market.values()].map((m) => ({ symbol: m.symbol, tickSize: m.tickSize, lastPrice: m.lastPrice, biasDirection: m.biasDirection, biasStrength: m.biasStrength, biasUntil: m.biasUntil })),
      energyPrices: this.energy,
      positionsSummary: this.positionsSummary(),
      simState: this.state,
      eventLog: this.adminLog.slice(-40).reverse(),
    };
  }

  persistWalletsAndHoldings() {
    const upWallet = this.db.prepare('UPDATE wallets SET cashUSD = ? WHERE playerId = ?');
    const upHold = this.db.prepare('INSERT INTO holdings(playerId,symbol,qty,avgEntry) VALUES(?,?,?,?) ON CONFLICT(playerId,symbol) DO UPDATE SET qty=excluded.qty, avgEntry=excluded.avgEntry');
    for (const p of this.players.values()) {
      upWallet.run(p.cashUSD, p.id);
      for (const [sym, h] of Object.entries(p.holdings)) upHold.run(p.id, sym, h.qty, h.avgEntry);
    }
  }

  persistSnapshot() {
    this.db.prepare('INSERT INTO snapshots(roomId,tick,createdAt,leaderboard) VALUES(?,?,?,?)').run(ROOM_ID, this.state.tick, Date.now(), JSON.stringify(this.leaderboard()));
  }

  persistMarket() {
    const up = this.db.prepare('INSERT INTO market_state(symbol,lastPrice,biasDirection,biasStrength,biasUntil,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET lastPrice=excluded.lastPrice,biasDirection=excluded.biasDirection,biasStrength=excluded.biasStrength,biasUntil=excluded.biasUntil,updatedAt=excluded.updatedAt');
    for (const m of this.market.values()) up.run(m.symbol, m.lastPrice, m.biasDirection, m.biasStrength, m.biasUntil, Date.now());
  }

  persistSimState() {
    this.db.prepare('INSERT INTO sim_state(roomId,status,startedAt,tick) VALUES(?,?,?,?) ON CONFLICT(roomId) DO UPDATE SET status=excluded.status,startedAt=excluded.startedAt,tick=excluded.tick').run(ROOM_ID, this.state.status, this.state.startedAt, this.state.tick);
  }

  logAdmin(msg) {
    this.adminLog.push({ t: Date.now(), message: msg });
    this.adminLog = this.adminLog.slice(-200);
  }
}
