import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ASSETS, REGIONS, RIG_CATALOG, SIM_STATUS } from '../shared/contracts.mjs';

const STARTING_CASH = 100000;
const ROOM_ID = 'MAIN';
const BLOCKS_PER_DAY = 144;
const SIM_START_DATE_UTC = Date.UTC(2015, 0, 1);
const EPS = 0.00000001;

const BASE_ENERGY = {
  ASIA: 0.09,
  EUROPE: 0.17,
  AMERICA: 0.12,
};

const YEAR_REGIMES = {
  2015: { stepPct: 0.002, magnetK: 0.05, maxDriftPct: 0.018, volatilityMult: 1 },
  2016: { stepPct: 0.0023, magnetK: 0.06, maxDriftPct: 0.02, volatilityMult: 1.1 },
  2017: { stepPct: 0.0035, magnetK: 0.04, maxDriftPct: 0.03, volatilityMult: 1.8 },
  2018: { stepPct: 0.003, magnetK: 0.08, maxDriftPct: 0.028, volatilityMult: 1.6 },
  2019: { stepPct: 0.0015, magnetK: 0.07, maxDriftPct: 0.015, volatilityMult: 1.1 },
  2020: { stepPct: 0.001, magnetK: 0.09, maxDriftPct: 0.02, volatilityMult: 1.3 },
};

const uuid = () => crypto.randomUUID();
const clampMin = (v, min) => Math.max(min, v);
const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const [header, ...rows] = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const cols = header.split(',').map((c) => c.trim());
  return rows.filter(Boolean).map((line) => {
    const vals = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
  });
}

export class SimEngine {
  constructor(db, opts = {}) {
    this.db = db;
    this.tickMs = opts.tickMs ?? 1000;
    this.rng = opts.seed != null ? mulberry32(Number(opts.seed)) : Math.random;
    this.state = { roomId: ROOM_ID, status: SIM_STATUS.LOBBY, startedAt: null, tick: 0 };

    this.btcSeries = this.loadBtcSeries();
    this.networkHashrateSeries = this.loadHashrateSeries();
    this.scheduledEvents = this.loadEvents();
    this.nextScheduledEventIdx = 0;

    this.players = new Map();
    this.socketToPlayer = new Map();
    this.market = new Map(ASSETS.map((a) => [a.symbol, { ...a, lastPrice: a.basePrice, previousPrice: a.basePrice, biasDirection: null, biasStrength: 0.5, biasUntilTick: -1, updatedAt: Date.now() }]));
    const btcStart = this.btcSeries.get('2015-01-01');
    if (btcStart) {
      this.market.get('BTC').lastPrice = btcStart;
      this.market.get('BTC').previousPrice = btcStart;
    }

    this.assetUnlocked = Object.fromEntries(ASSETS.map((a) => [a.symbol, a.symbol === 'BTC']));
    this.energy = { ...BASE_ENERGY };
    this.energyModifiers = [];
    this.activeVolatility = [];
    this.activeHashrateMultipliers = [];
    this.news = [];
    this.adminLog = [];
    this.rate = new Map();
    this.persistMarket();
  }

  loadBtcSeries() {
    const rows = parseCsv(path.join(process.cwd(), 'server', 'data', 'btc_usd_daily_2015_2020.csv'));
    return new Map(rows.map((r) => [r.date, Number(r.close)]));
  }

  loadHashrateSeries() {
    const rows = parseCsv(path.join(process.cwd(), 'server', 'data', 'btc_network_hashrate_monthly_2015_2020.csv'));
    return new Map(rows.map((r) => [r.month.slice(0, 7), Number(r.hashrateTHs)]));
  }

  loadEvents() {
    const p = path.join(process.cwd(), 'server', 'data', 'events_2015_2020.json');
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8')).sort((a, b) => a.date.localeCompare(b.date));
  }

  currentSimDateMs() { return SIM_START_DATE_UTC + this.state.tick * 24 * 60 * 60 * 1000; }
  simDateISO() { return new Date(this.currentSimDateMs()).toISOString(); }

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
      cashUSD: STARTING_CASH, startingCash: STARTING_CASH,
      holdings: Object.fromEntries(ASSETS.map((a) => [a.symbol, { qty: 0, avgEntry: 0 }])),
      rigs: [],
    };
    this.players.set(id, player);
    this.socketToPlayer.set(socketId, id);
    this.db.prepare('INSERT INTO players(id,name,roomId,createdAt,startingCash) VALUES (?,?,?,?,?)').run(id, player.name, ROOM_ID, createdAt, STARTING_CASH);
    this.db.prepare('INSERT INTO wallets(playerId,cashUSD) VALUES(?,?)').run(id, STARTING_CASH);
    return player;
  }

  reconnect({ socketId, playerId }) { const p = this.players.get(playerId); if (!p) return null; p.socketId = socketId; this.socketToPlayer.set(socketId, playerId); return p; }
  removeSocket(socketId) { this.socketToPlayer.delete(socketId); }
  getPlayerBySocket(socketId) { const id = this.socketToPlayer.get(socketId); return id ? this.players.get(id) : null; }

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

  start() { if (this.state.status === SIM_STATUS.RUNNING) return; this.state.status = SIM_STATUS.RUNNING; this.state.startedAt = this.state.startedAt || Date.now(); this.persistSimState(); this.logAdmin('Sim started'); }
  pause() { if (this.state.status !== SIM_STATUS.RUNNING) return; this.state.status = SIM_STATUS.PAUSED; this.persistSimState(); this.logAdmin('Sim paused'); }
  end() { this.state.status = SIM_STATUS.ENDED; this.persistSimState(); this.logAdmin('Sim ended'); }
  setTickMs(ms) { if (![500, 1000].includes(ms)) return false; this.tickMs = ms; this.logAdmin(`Tick speed changed to ${ms}ms/day`); return true; }

  blockRewardForDate(dateMs) {
    const d = toISODate(dateMs);
    if (d < '2016-07-09') return 25;
    if (d < '2020-05-11') return 12.5;
    return 6.25;
  }

  networkHashrateTHs(dateMs) {
    const monthKey = new Date(dateMs).toISOString().slice(0, 7);
    const base = this.networkHashrateSeries.get(monthKey) ?? [...this.networkHashrateSeries.values()].at(-1) ?? 1;
    const mult = this.activeHashrateMultipliers.reduce((acc, r) => acc * r.multiplier, 1);
    return base * mult;
  }

  triggerEvent(ev) {
    const newsEvent = {
      id: uuid(),
      timestamp: Date.now(),
      headline: ev.headline,
      body: ev.body,
      tags: ev.tags || [],
      date: ev.date,
      effects: ev.effects || {},
    };
    this.news.unshift(newsEvent);
    this.news = this.news.slice(0, 200);

    const effects = ev.effects || {};
    if (effects.unlockAsset) {
      const unlocks = Array.isArray(effects.unlockAsset) ? effects.unlockAsset : [effects.unlockAsset];
      for (const sym of unlocks) if (this.assetUnlocked[sym] != null) this.assetUnlocked[sym] = true;
    }
    if (effects.priceBias) {
      const { symbol = 'BTC', direction = 'UP', strength = 0.65, durationDays = 30 } = effects.priceBias;
      const m = this.market.get(symbol);
      if (m) {
        m.biasDirection = direction;
        m.biasStrength = Math.max(0.51, Math.min(0.95, Number(strength)));
        m.biasUntilTick = this.state.tick + Number(durationDays);
      }
    }
    if (effects.energyDelta) {
      const regions = effects.energyDelta.regions || REGIONS;
      const durationDays = Number(effects.energyDelta.durationDays || 0);
      for (const region of regions) {
        this.energyModifiers.push({ region, delta: Number(effects.energyDelta.delta || 0), untilTick: durationDays > 0 ? this.state.tick + durationDays : Number.POSITIVE_INFINITY });
      }
    }
    if (effects.volatility) {
      this.activeVolatility.push({ multiplier: Number(effects.volatility.multiplier || 1), untilTick: this.state.tick + Number(effects.volatility.durationDays || 30) });
    }
    if (effects.networkHashrateMultiplier) {
      this.activeHashrateMultipliers.push({ multiplier: Number(effects.networkHashrateMultiplier.multiplier || 1), untilTick: this.state.tick + Number(effects.networkHashrateMultiplier.durationDays || 30) });
    }
    this.logAdmin(`Scheduled event: ${ev.headline}`);
  }

  applyScheduledEvents() {
    const simDate = toISODate(this.currentSimDateMs());
    while (this.nextScheduledEventIdx < this.scheduledEvents.length && this.scheduledEvents[this.nextScheduledEventIdx].date <= simDate) {
      const ev = this.scheduledEvents[this.nextScheduledEventIdx];
      if (ev.date === simDate) this.triggerEvent(ev);
      this.nextScheduledEventIdx += 1;
    }
  }

  applyEnergyAndRegimes() {
    this.energy = { ...BASE_ENERGY };
    this.energyModifiers = this.energyModifiers.filter((m) => m.untilTick > this.state.tick);
    this.activeVolatility = this.activeVolatility.filter((m) => m.untilTick > this.state.tick);
    this.activeHashrateMultipliers = this.activeHashrateMultipliers.filter((m) => m.untilTick > this.state.tick);
    for (const mod of this.energyModifiers) this.energy[mod.region] = Math.max(0.02, this.energy[mod.region] + mod.delta);
  }

  priceStep(asset) {
    const simDateMs = this.currentSimDateMs();
    const year = new Date(simDateMs).getUTCFullYear();
    const regime = YEAR_REGIMES[year] || YEAR_REGIMES[2020];
    const volMult = this.activeVolatility.reduce((acc, x) => acc * x.multiplier, 1);
    const stepPct = regime.stepPct * volMult;
    const stepSizeUSD = Math.max(asset.symbol === 'BTC' ? 1 : EPS, Math.round(asset.lastPrice * stepPct * 1000000) / 1000000);

    const biasActive = asset.biasUntilTick >= this.state.tick;
    const upProb = biasActive
      ? (asset.biasDirection === 'UP' ? asset.biasStrength : 1 - asset.biasStrength)
      : 0.5;
    const signedStep = this.rng() < upProb ? stepSizeUSD : -stepSizeUSD;

    const dateKey = toISODate(simDateMs);
    const targetPrice = asset.symbol === 'BTC' ? (this.btcSeries.get(dateKey) ?? asset.lastPrice) : asset.lastPrice;
    const maxDrift = asset.lastPrice * regime.maxDriftPct;
    const drift = Math.max(-maxDrift, Math.min(maxDrift, (targetPrice - asset.lastPrice) * regime.magnetK));

    asset.previousPrice = asset.lastPrice;
    asset.lastPrice = clampMin(asset.lastPrice + signedStep + drift, EPS);
    asset.updatedAt = Date.now();
  }

  stepTick() {
    if (this.state.status !== SIM_STATUS.RUNNING) return;
    this.state.tick += 1;
    this.applyScheduledEvents();
    this.applyEnergyAndRegimes();

    for (const asset of this.market.values()) {
      if (!this.assetUnlocked[asset.symbol] && asset.symbol !== 'BTC') continue;
      this.priceStep(asset);
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
    const networkHashrate = this.networkHashrateTHs(this.currentSimDateMs());
    const reward = this.blockRewardForDate(this.currentSimDateMs());
    for (const rig of player.rigs) {
      const share = rig.hashrateTHs / networkHashrate;
      minedBTC += share * BLOCKS_PER_DAY * reward;
      const powerKW = (rig.hashrateTHs * rig.efficiencyWPerTH) / 1000;
      energyCost += powerKW * 24 * (this.energy[rig.region] ?? 0.12);
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
    if (!this.assetUnlocked[symbol]) return { ok: false, message: `${symbol} is locked` };
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
    if (!this.assertRate(player.id, 'trade')) return { ok: false, message: 'Rate limit exceeded' };
    qty = Number(qty);
    if (!(qty > 0)) return { ok: false, message: 'Invalid quantity' };
    const asset = this.market.get(symbol);
    const h = player.holdings[symbol];
    if (!asset || !h) return { ok: false, message: 'Unknown asset' };
    if (h.qty < qty) return { ok: false, message: 'Not enough quantity' };
    h.qty -= qty;
    if (h.qty === 0) h.avgEntry = 0;
    player.cashUSD += qty * asset.lastPrice;
    this.recordTrade(player.id, symbol, 'SELL', qty, asset.lastPrice);
    return { ok: true };
  }

  buyRig(player, region, rigType, count = 1) {
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
    else targets = player.rigs.filter((r) => (!region || r.region === region) && (!rigType || r.rigType === rigType)).slice(0, Math.max(1, Number(count) || 1));
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
      id: uuid(), timestamp: Date.now(), headline: String(payload.headline || 'Untitled').slice(0, 120), body: String(payload.body || '').slice(0, 500), tags: payload.tags || [],
      affectedAssets: payload.affectedAssets || [], biasConfig: payload.biasConfig || null, energyConfig: payload.energyConfig || null,
      durationSec: Number(payload.durationSec || 120), severity: payload.severity || 'MEDIUM',
    };
    this.news.unshift(event);
    this.news = this.news.slice(0, 200);
    const durationDays = Math.max(1, Math.round(event.durationSec / (this.tickMs / 1000)));
    if (event.biasConfig) {
      const { direction = 'UP', strength = 0.65 } = event.biasConfig;
      for (const sym of event.affectedAssets) {
        const m = this.market.get(sym);
        if (m) {
          m.biasDirection = direction;
          m.biasStrength = Math.min(0.95, Math.max(0.51, Number(strength) || 0.65));
          m.biasUntilTick = this.state.tick + durationDays;
        }
      }
    }
    if (event.energyConfig?.changes) {
      for (const change of event.energyConfig.changes) {
        this.energyModifiers.push({ region: change.region, delta: Number(change.delta || 0), untilTick: this.state.tick + durationDays });
      }
    }
    this.db.prepare('INSERT INTO news_events(id,timestamp,headline,body,tags,affectedAssets,biasConfig,energyConfig,durationSec,severity) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      event.id, event.timestamp, event.headline, event.body, JSON.stringify(event.tags), JSON.stringify(event.affectedAssets), JSON.stringify(event.biasConfig), JSON.stringify(event.energyConfig), event.durationSec, event.severity,
    );
    this.logAdmin(`News created: ${event.headline}`);
    return event;
  }

  updateMarketParams(payload) {
    if (payload?.tickMs) this.setTickMs(Number(payload.tickMs));
    for (const row of payload?.assets || []) {
      const m = this.market.get(row.symbol);
      if (!m) continue;
      if (row.manualBias) {
        m.biasDirection = row.manualBias.direction;
        m.biasStrength = Number(row.manualBias.strength || 0.6);
        m.biasUntilTick = this.state.tick + Number(row.manualBias.durationDays || 15);
      }
      if (row.resetBias) {
        m.biasDirection = null;
        m.biasStrength = 0.5;
        m.biasUntilTick = -1;
      }
    }
    for (const e of payload?.energy || []) if (REGIONS.includes(e.region) && Number(e.energyPriceUSD) > 0) this.energy[e.region] = Number(e.energyPriceUSD);
    this.logAdmin('Market params updated');
  }

  recordTrade(playerId, symbol, side, qty, fillPrice) { this.db.prepare('INSERT INTO trades(id,playerId,symbol,side,qty,fillPrice,feeUSD,timestamp) VALUES (?,?,?,?,?,?,?,?)').run(uuid(), playerId, symbol, side, qty, fillPrice, 0, Date.now()); }

  netWorth(player) {
    const holdingsValue = Object.entries(player.holdings).reduce((sum, [symbol, h]) => sum + h.qty * (this.market.get(symbol)?.lastPrice || 0), 0);
    const rigValue = player.rigs.reduce((sum, r) => sum + r.purchasePrice * r.resaleValuePct, 0);
    return player.cashUSD + holdingsValue + rigValue;
  }

  leaderboard() { return [...this.players.values()].map((p) => { const nw = this.netWorth(p); return { playerId: p.id, name: p.name, cash: Number(p.cashUSD.toFixed(2)), netWorth: Number(nw.toFixed(2)), pnl: Number((nw - p.startingCash).toFixed(2)) }; }).sort((a, b) => b.pnl - a.pnl); }

  positionsSummary() {
    const rows = [...this.players.values()].map((p) => ({ name: p.name, btcQty: p.holdings.BTC.qty, memeQty: ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK'].reduce((s, sym) => s + (p.holdings[sym]?.qty || 0), 0), rigs: p.rigs.length })).sort((a, b) => b.btcQty - a.btcQty);
    const totalRigsByRegion = REGIONS.reduce((acc, r) => ({ ...acc, [r]: 0 }), {});
    for (const p of this.players.values()) for (const rig of p.rigs) totalRigsByRegion[rig.region] += 1;
    const totalCash = [...this.players.values()].reduce((s, p) => s + p.cashUSD, 0);
    return { rows: rows.slice(0, 10), totalRigsByRegion, totalCash: Number(totalCash.toFixed(2)) };
  }

  playerView(player) {
    return {
      id: player.id, name: player.name, cash: Number(player.cashUSD.toFixed(2)), holdings: player.holdings, rigs: player.rigs,
      netWorth: Number(this.netWorth(player).toFixed(2)), pnl: Number((this.netWorth(player) - player.startingCash).toFixed(2)),
      simDate: this.simDateISO(), unlockedAssets: this.assetUnlocked,
    };
  }

  marketView() {
    return {
      time: Date.now(), simDate: this.simDateISO(),
      prices: Object.fromEntries([...this.market.entries()].map(([k, v]) => [k, { price: v.lastPrice, previous: v.previousPrice, type: v.type }])),
      unlockedAssets: this.assetUnlocked,
      activeBiases: [...this.market.values()].filter((m) => m.biasUntilTick >= this.state.tick).map((m) => ({ symbol: m.symbol, direction: m.biasDirection, strength: m.biasStrength, untilTick: m.biasUntilTick })),
    };
  }

  lobbyView() { return { players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name })), status: this.state.status }; }

  adminMarketState() {
    return {
      perAsset: [...this.market.values()].map((m) => ({ symbol: m.symbol, lastPrice: m.lastPrice, biasDirection: m.biasDirection, biasStrength: m.biasStrength, biasUntilTick: m.biasUntilTick, unlocked: !!this.assetUnlocked[m.symbol] })),
      energyPrices: this.energy,
      positionsSummary: this.positionsSummary(),
      simState: { ...this.state, simDate: this.simDateISO(), tickMs: this.tickMs, networkHashrateTHs: this.networkHashrateTHs(this.currentSimDateMs()), blockReward: this.blockRewardForDate(this.currentSimDateMs()) },
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

  persistSnapshot() { this.db.prepare('INSERT INTO snapshots(roomId,tick,createdAt,leaderboard) VALUES(?,?,?,?)').run(ROOM_ID, this.state.tick, Date.now(), JSON.stringify(this.leaderboard())); }

  persistMarket() {
    const up = this.db.prepare('INSERT INTO market_state(symbol,lastPrice,biasDirection,biasStrength,biasUntil,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET lastPrice=excluded.lastPrice,biasDirection=excluded.biasDirection,biasStrength=excluded.biasStrength,biasUntil=excluded.biasUntil,updatedAt=excluded.updatedAt');
    for (const m of this.market.values()) up.run(m.symbol, m.lastPrice, m.biasDirection, m.biasStrength, m.biasUntilTick, Date.now());
  }

  persistSimState() { this.db.prepare('INSERT INTO sim_state(roomId,status,startedAt,tick) VALUES(?,?,?,?) ON CONFLICT(roomId) DO UPDATE SET status=excluded.status,startedAt=excluded.startedAt,tick=excluded.tick').run(ROOM_ID, this.state.status, this.state.startedAt, this.state.tick); }

  logAdmin(msg) { this.adminLog.push({ t: Date.now(), message: msg }); this.adminLog = this.adminLog.slice(-200); }
}
