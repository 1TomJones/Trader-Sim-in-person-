import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ASSETS, REGIONS, RIG_CATALOG, SIM_STATUS } from '../shared/contracts.mjs';

const STARTING_CASH = 100000;
const ROOM_ID = 'MAIN';
const BLOCKS_PER_DAY = 144;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIM_START_DATE_UTC = Date.UTC(2013, 0, 1);
const SIM_END_DATE_UTC = Date.UTC(2017, 11, 31);
const EPS = 0.00000001;

const BASE_ENERGY = { ASIA: 0.09, EUROPE: 0.17, AMERICA: 0.12 };

const YEAR_REGIMES = {
  2013: { stepPct: 0.05, magnetK: 0.08, maxDriftPct: 0.11 },
  2014: { stepPct: 0.025, magnetK: 0.07, maxDriftPct: 0.08 },
  2015: { stepPct: 0.012, magnetK: 0.06, maxDriftPct: 0.04 },
  2016: { stepPct: 0.015, magnetK: 0.06, maxDriftPct: 0.05 },
  2017: { stepPct: 0.045, magnetK: 0.04, maxDriftPct: 0.12 },
};

const uuid = () => crypto.randomUUID();
const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const clampMin = (v, min) => Math.max(min, v);

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
    this.seriesDates = [...this.btcSeries.keys()].sort();
    this.networkHashrateSeries = this.loadHashrateSeries();
    this.scheduledEvents = this.loadEvents();
    this.nextScheduledEventIdx = 0;

    this.players = new Map();
    this.socketToPlayer = new Map();
    this.market = new Map(ASSETS.map((a) => [a.symbol, { ...a, lastPrice: a.basePrice, previousPrice: a.basePrice, biasDirection: null, biasStrength: 0, biasUntilTick: -1, magnetAdjust: 1, updatedAt: Date.now() }]));

    const btcStart = this.btcSeries.get('2013-01-01');
    if (btcStart) {
      this.market.get('BTC').lastPrice = btcStart;
      this.market.get('BTC').previousPrice = btcStart;
    }

    this.energy = { ...BASE_ENERGY };
    this.energyModifiers = [];
    this.volatilityBoosts = [];
    this.magnetAdjusters = [];
    this.news = [];
    this.adminLog = [];
    this.rate = new Map();
    this.lastTriggeredNews = [];
    this.persistMarket();
  }

  loadBtcSeries() {
    const rows = parseCsv(path.join(process.cwd(), 'server', 'data', 'btc_usd_daily_2013_2017.csv'));
    return new Map(rows.map((r) => [r.date, Number(r.close)]));
  }

  loadHashrateSeries() {
    const rows = parseCsv(path.join(process.cwd(), 'server', 'data', 'network_hashrate_monthly_2013_2017.csv'));
    return new Map(rows.map((r) => [r.month.slice(0, 7), Number(r.hashrateTHs)]));
  }

  loadEvents() {
    const p = path.join(process.cwd(), 'server', 'data', 'events_2013_2017.json');
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8')).sort((a, b) => a.date.localeCompare(b.date));
  }

  currentSimDateMs() {
    return Math.min(SIM_END_DATE_UTC, SIM_START_DATE_UTC + this.state.tick * DAY_MS);
  }

  simDateISO() { return new Date(this.currentSimDateMs()).toISOString(); }

  initialCandles52() {
    const idx = Math.max(51, this.state.tick);
    const start = Math.max(0, idx - 51);
    const out = [];
    for (let i = start; i <= idx; i += 1) {
      const date = this.seriesDates[i];
      if (!date) continue;
      const close = this.btcSeries.get(date);
      out.push({ time: Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1000), open: close, high: close, low: close, close });
    }
    return out;
  }

  dailyCandle() {
    const d = this.simDateISO().slice(0, 10);
    const p = this.market.get('BTC').lastPrice;
    return { time: Math.floor(Date.parse(`${d}T00:00:00.000Z`) / 1000), open: p, high: p, low: p, close: p };
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
      id,
      socketId,
      name: String(name || 'Player').slice(0, 24),
      roomId: ROOM_ID,
      createdAt,
      cashUSD: STARTING_CASH,
      startingCash: STARTING_CASH,
      holdings: { BTC: { qty: 0, avgEntry: 0 } },
      realizedPnL: 0,
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
    return toISODate(dateMs) < '2016-07-09' ? 25 : 12.5;
  }

  nextHalvingCountdownDays(dateMs) {
    const halving = Date.parse('2016-07-09T00:00:00.000Z');
    if (dateMs >= halving) return null;
    return Math.ceil((halving - dateMs) / DAY_MS);
  }

  networkHashrateTHs(dateMs) {
    const d = new Date(dateMs);
    const monthStart = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const curr = this.networkHashrateSeries.get(monthStart);
    if (curr != null) return curr;
    return [...this.networkHashrateSeries.values()].at(-1) ?? 1000;
  }

  triggerEvent(ev) {
    const newsEvent = { id: uuid(), timestamp: Date.now(), headline: ev.headline, body: ev.body, date: ev.date, effects: ev.effects || {} };
    this.news.unshift(newsEvent);
    this.lastTriggeredNews.push(newsEvent);
    this.news = this.news.slice(0, 200);

    const { effects = {} } = ev;
    if (effects.biasDirection) {
      const m = this.market.get('BTC');
      m.biasDirection = effects.biasDirection;
      m.biasStrength = Number(effects.biasStrength || 0);
      m.biasUntilTick = this.state.tick + Number(effects.durationDays || 1);
    }
    if (effects.volatilityBoost) {
      this.volatilityBoosts.push({ multiplier: Number(effects.volatilityBoost), untilTick: this.state.tick + Number(effects.durationDays || 7) });
    }
    if (effects.magnetAdjust) {
      this.magnetAdjusters.push({ adjust: Number(effects.magnetAdjust), untilTick: this.state.tick + Number(effects.durationDays || 7) });
    }
    if (effects.energyDelta) {
      const regions = effects.energyDelta.regions || REGIONS;
      for (const region of regions) {
        this.energyModifiers.push({ region, delta: Number(effects.energyDelta.delta || 0), untilTick: this.state.tick + Number(effects.durationDays || 7) });
      }
    }
    this.logAdmin(`Scheduled event: ${ev.headline}`);
  }

  consumeTriggeredNews() {
    const out = [...this.lastTriggeredNews];
    this.lastTriggeredNews = [];
    return out;
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
    this.volatilityBoosts = this.volatilityBoosts.filter((m) => m.untilTick > this.state.tick);
    this.magnetAdjusters = this.magnetAdjusters.filter((m) => m.untilTick > this.state.tick);
    for (const mod of this.energyModifiers) this.energy[mod.region] = Math.max(0.02, this.energy[mod.region] + mod.delta);
  }

  priceStep(asset) {
    const simDateMs = this.currentSimDateMs();
    const year = new Date(simDateMs).getUTCFullYear();
    const regime = YEAR_REGIMES[year] || YEAR_REGIMES[2017];
    const extraVol = this.volatilityBoosts.reduce((acc, x) => acc * x.multiplier, 1);
    const stepPct = regime.stepPct * extraVol;
    const stepSizeUSD = Math.max(1, Math.round(asset.lastPrice * stepPct));

    let upProb = 0.5;
    const biasActive = asset.biasUntilTick >= this.state.tick;
    if (biasActive) {
      const delta = clamp(asset.biasStrength, 0, 0.45);
      upProb = asset.biasDirection === 'UP' ? 0.5 + delta : 0.5 - delta;
    }
    const signedStep = this.rng() < upProb ? stepSizeUSD : -stepSizeUSD;

    const dateKey = toISODate(simDateMs);
    const targetPrice = this.btcSeries.get(dateKey) ?? asset.lastPrice;
    const maxDrift = asset.lastPrice * regime.maxDriftPct;
    const magnetAdjust = this.magnetAdjusters.reduce((acc, m) => acc * m.adjust, 1);
    const driftTowardTarget = clamp((targetPrice - asset.lastPrice) * regime.magnetK * magnetAdjust, -maxDrift, +maxDrift);

    asset.previousPrice = asset.lastPrice;
    asset.lastPrice = clampMin(asset.lastPrice + signedStep + driftTowardTarget, EPS);
    asset.updatedAt = Date.now();
  }

  stepTick() {
    if (this.state.status !== SIM_STATUS.RUNNING) return;
    if (this.currentSimDateMs() >= SIM_END_DATE_UTC) {
      this.end();
      return;
    }
    this.state.tick += 1;
    this.applyScheduledEvents();
    this.applyEnergyAndRegimes();

    this.priceStep(this.market.get('BTC'));

    for (const p of this.players.values()) this.applyMiningForPlayer(p);
    this.persistWalletsAndHoldings();
    if (this.state.tick % 10 === 0) this.persistSnapshot();
    this.persistMarket();
    this.persistSimState();
  }

  miningMetricsForPlayer(player) {
    const networkHashrate = this.networkHashrateTHs(this.currentSimDateMs());
    const playerHashrate = player.rigs.reduce((s, r) => s + r.hashrateTHs, 0);
    const playerShare = networkHashrate > 0 ? playerHashrate / networkHashrate : 0;
    const blockReward = this.blockRewardForDate(this.currentSimDateMs());
    const btcPerDay = playerShare * BLOCKS_PER_DAY * blockReward;
    const btcPrice = this.market.get('BTC').lastPrice;
    const usdPerDay = btcPerDay * btcPrice;
    const totalPowerKW = player.rigs.reduce((s, r) => s + (r.hashrateTHs * r.efficiencyWPerTH) / 1000, 0);
    const energyCostDaily = player.rigs.reduce((sum, rig) => {
      const powerKW = (rig.hashrateTHs * rig.efficiencyWPerTH) / 1000;
      return sum + powerKW * 24 * (this.energy[rig.region] ?? 0.12);
    }, 0);
    return {
      playerHashrateTHs: playerHashrate,
      networkHashrateTHs: networkHashrate,
      playerSharePct: playerShare * 100,
      btcMinedPerDay: btcPerDay,
      usdMinedPerDay: usdPerDay,
      energyPrices: this.energy,
      totalPowerDrawKW: totalPowerKW,
      dailyEnergyCostUSD: energyCostDaily,
      netMiningProfitUSDPerDay: usdPerDay - energyCostDaily,
      blockRewardBTC: blockReward,
      nextHalvingCountdownDays: this.nextHalvingCountdownDays(this.currentSimDateMs()),
      difficultyIndex: networkHashrate / 1000,
    };
  }

  applyMiningForPlayer(player) {
    const mm = this.miningMetricsForPlayer(player);
    if (mm.btcMinedPerDay > 0) {
      const h = player.holdings.BTC;
      const oldValue = h.qty * h.avgEntry;
      h.qty += mm.btcMinedPerDay;
      const px = this.market.get('BTC').lastPrice;
      h.avgEntry = h.qty === 0 ? 0 : (oldValue + mm.btcMinedPerDay * px) / h.qty;
    }
    if (mm.dailyEnergyCostUSD > 0) {
      player.cashUSD -= mm.dailyEnergyCostUSD;
      this.db.prepare('INSERT INTO cost_ledger(id,playerId,type,amountUSD,timestamp) VALUES(?,?,?,?,?)').run(uuid(), player.id, 'ENERGY', Number(mm.dailyEnergyCostUSD.toFixed(6)), Date.now());
    }
  }

  buyCrypto(player, symbol, qty) {
    if (this.state.status !== SIM_STATUS.RUNNING) return { ok: false, message: 'Simulation not running' };
    if (!this.assertRate(player.id, 'trade')) return { ok: false, message: 'Rate limit exceeded' };
    if (symbol !== 'BTC') return { ok: false, message: 'BTC only' };
    qty = Number(qty);
    if (!(qty > 0)) return { ok: false, message: 'Invalid quantity' };
    const asset = this.market.get('BTC');
    const cost = qty * asset.lastPrice;
    if (!(player.cashUSD > 0 && player.cashUSD - cost >= 0)) return { ok: false, message: 'Insufficient cash' };
    const h = player.holdings.BTC;
    const oldValue = h.qty * h.avgEntry;
    h.qty += qty;
    h.avgEntry = (oldValue + cost) / h.qty;
    player.cashUSD -= cost;
    this.recordTrade(player.id, 'BTC', 'BUY', qty, asset.lastPrice);
    return { ok: true };
  }

  sellCrypto(player, symbol, qty) {
    if (!this.assertRate(player.id, 'trade')) return { ok: false, message: 'Rate limit exceeded' };
    if (symbol !== 'BTC') return { ok: false, message: 'BTC only' };
    qty = Number(qty);
    if (!(qty > 0)) return { ok: false, message: 'Invalid quantity' };
    const asset = this.market.get('BTC');
    const h = player.holdings.BTC;
    if (h.qty < qty) return { ok: false, message: 'Not enough BTC' };
    h.qty -= qty;
    const realized = qty * (asset.lastPrice - h.avgEntry);
    player.realizedPnL += realized;
    if (h.qty === 0) h.avgEntry = 0;
    player.cashUSD += qty * asset.lastPrice;
    this.recordTrade(player.id, 'BTC', 'SELL', qty, asset.lastPrice);
    return { ok: true };
  }

  buyRig(player, region, rigType, count = 1) {
    if (!this.assertRate(player.id, 'rig')) return { ok: false, message: 'Rate limit exceeded' };
    const rig = RIG_CATALOG[rigType];
    count = Math.max(1, Math.floor(Number(count) || 1));
    if (!rig || !REGIONS.includes(region)) return { ok: false, message: 'Invalid rig request' };
    const totalCost = rig.purchasePrice * count;
    if (!(player.cashUSD > 0 && player.cashUSD - totalCost >= 0)) return { ok: false, message: 'Insufficient cash' };
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

  updateMarketParams(payload) {
    if (payload?.tickMs) this.setTickMs(Number(payload.tickMs));
    for (const e of payload?.energy || []) if (REGIONS.includes(e.region) && Number(e.energyPriceUSD) > 0) this.energy[e.region] = Number(e.energyPriceUSD);
    this.logAdmin('Market params updated');
  }

  recordTrade(playerId, symbol, side, qty, fillPrice) { this.db.prepare('INSERT INTO trades(id,playerId,symbol,side,qty,fillPrice,feeUSD,timestamp) VALUES (?,?,?,?,?,?,?,?)').run(uuid(), playerId, symbol, side, qty, fillPrice, 0, Date.now()); }

  netWorth(player) {
    const btcPx = this.market.get('BTC').lastPrice;
    const holdingsValue = player.holdings.BTC.qty * btcPx;
    const rigValue = player.rigs.reduce((sum, r) => sum + r.purchasePrice * r.resaleValuePct, 0);
    return player.cashUSD + holdingsValue + rigValue;
  }

  leaderboard() {
    return [...this.players.values()]
      .map((p) => {
        const nw = this.netWorth(p);
        return { playerId: p.id, name: p.name, cash: Number(p.cashUSD.toFixed(2)), netWorth: Number(nw.toFixed(2)), pnl: Number((nw - p.startingCash).toFixed(2)) };
      })
      .sort((a, b) => b.pnl - a.pnl);
  }

  positionsSummary() {
    const rows = [...this.players.values()].map((p) => ({ name: p.name, btcQty: p.holdings.BTC.qty, rigs: p.rigs.length })).sort((a, b) => b.btcQty - a.btcQty);
    const totalRigsByRegion = REGIONS.reduce((acc, r) => ({ ...acc, [r]: 0 }), {});
    for (const p of this.players.values()) for (const rig of p.rigs) totalRigsByRegion[rig.region] += 1;
    const totalCash = [...this.players.values()].reduce((s, p) => s + p.cashUSD, 0);
    return { rows: rows.slice(0, 10), totalRigsByRegion, totalCash: Number(totalCash.toFixed(2)) };
  }

  playerView(player) {
    const btc = player.holdings.BTC;
    const price = this.market.get('BTC').lastPrice;
    const unrealizedPnL = (price - btc.avgEntry) * btc.qty;
    return {
      id: player.id,
      name: player.name,
      cash: Number(player.cashUSD.toFixed(2)),
      btcQty: btc.qty,
      avgEntry: btc.avgEntry,
      unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
      realizedPnL: Number(player.realizedPnL.toFixed(2)),
      rigs: player.rigs,
      miningMetrics: this.miningMetricsForPlayer(player),
      netWorth: Number(this.netWorth(player).toFixed(2)),
      pnl: Number((this.netWorth(player) - player.startingCash).toFixed(2)),
      simDate: this.simDateISO(),
    };
  }

  marketView(includeHistory = false) {
    const btc = this.market.get('BTC');
    return {
      date: toISODate(this.currentSimDateMs()),
      btcPrice: btc.lastPrice,
      candle: this.dailyCandle(),
      ...(includeHistory ? { last52Candles: this.initialCandles52() } : {}),
      blockReward: this.blockRewardForDate(this.currentSimDateMs()),
      networkHashrate: this.networkHashrateTHs(this.currentSimDateMs()),
      energyPrices: this.energy,
      prices: { BTC: { price: btc.lastPrice, previous: btc.previousPrice, type: 'major' } },
    };
  }

  lobbyView() { return { players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name })), status: this.state.status }; }

  adminMarketState() {
    const m = this.market.get('BTC');
    return {
      perAsset: [{ symbol: 'BTC', lastPrice: m.lastPrice, biasDirection: m.biasDirection, biasStrength: m.biasStrength, biasUntilTick: m.biasUntilTick, unlocked: true }],
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
      upHold.run(p.id, 'BTC', p.holdings.BTC.qty, p.holdings.BTC.avgEntry);
    }
  }

  persistSnapshot() { this.db.prepare('INSERT INTO snapshots(roomId,tick,createdAt,leaderboard) VALUES(?,?,?,?)').run(ROOM_ID, this.state.tick, Date.now(), JSON.stringify(this.leaderboard())); }

  persistMarket() {
    const up = this.db.prepare('INSERT INTO market_state(symbol,lastPrice,biasDirection,biasStrength,biasUntil,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET lastPrice=excluded.lastPrice,biasDirection=excluded.biasDirection,biasStrength=excluded.biasStrength,biasUntil=excluded.biasUntil,updatedAt=excluded.updatedAt');
    const m = this.market.get('BTC');
    up.run(m.symbol, m.lastPrice, m.biasDirection, m.biasStrength, m.biasUntilTick, Date.now());
  }

  persistSimState() { this.db.prepare('INSERT INTO sim_state(roomId,status,startedAt,tick) VALUES(?,?,?,?) ON CONFLICT(roomId) DO UPDATE SET status=excluded.status,startedAt=excluded.startedAt,tick=excluded.tick').run(ROOM_ID, this.state.status, this.state.startedAt, this.state.tick); }

  logAdmin(msg) { this.adminLog.push({ t: Date.now(), message: msg }); this.adminLog = this.adminLog.slice(-200); }
}
