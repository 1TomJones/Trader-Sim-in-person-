import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ASSETS, REGIONS, RIG_CATALOG, SIM_STATUS } from '../shared/contracts.mjs';

const STARTING_CASH = 10000;
const ROOM_ID = 'MAIN';
const BLOCKS_PER_DAY = 144;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIM_START_DATE_UTC = Date.UTC(2013, 0, 1);
const SIM_END_DATE_UTC = Date.UTC(2017, 11, 31);
const EPS = 0.00000001;

const HISTORY_BARS = 52;
const INTRADAY_STEPS = 12;
const HISTORY_DOWN_PROB = 0.6;
const HISTORY_FIRST_BAR_PRICE = 5.13;
const FAIR_VALUE_BAND_PCT = 5;
const FAIR_VALUE_SHIFT_PER_PCT = 0.02;
const MIN_PROB = 0.05;
const MAX_PROB = 0.95;
const BASE_DAILY_STEP_PCT = 0.012;

const BASE_ENERGY = { ASIA: 0.09, EUROPE: 0.17, AMERICA: 0.12 };

const uuid = () => crypto.randomUUID();
const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const clampMin = (v, min) => Math.max(min, v);
const IS_DEV = process.env.NODE_ENV !== 'production';

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

function invariant(condition, message) {
  if (!IS_DEV) return;
  if (!condition) throw new Error(`[PriceEngine invariant] ${message}`);
}

export class SimEngine {
  constructor(db, opts = {}) {
    this.db = db;
    this.tickMs = opts.tickMs ?? 1000;
    this.rng = opts.seed != null ? mulberry32(Number(opts.seed)) : Math.random;
    this.state = { roomId: ROOM_ID, status: SIM_STATUS.LOBBY, startedAt: null, tick: 0 };

    this.networkHashrateSeries = this.loadHashrateSeries();
    this.scheduledEvents = this.loadEvents();
    this.nextScheduledEventIdx = 0;
    this.players = new Map();
    this.socketToPlayer = new Map();

    this.dailyStepPct = Number(opts.dailyStepPct ?? process.env.DAILY_STEP_PCT ?? BASE_DAILY_STEP_PCT);
    this.volatilityMultiplier = Number(opts.volatilityMultiplier ?? process.env.VOLATILITY_MULTIPLIER ?? 1);

    this.fairValueSchedule = this.loadFairValueSchedule();
    const startFairValue = this.fairValueForDateMs(SIM_START_DATE_UTC);

    this.market = new Map(ASSETS.map((a) => [a.symbol, {
      ...a,
      lastPrice: startFairValue,
      previousPrice: startFairValue,
      fairValue: startFairValue,
      updatedAt: Date.now(),
    }]));

    this.energy = { ...BASE_ENERGY };
    this.energyModifiers = [];
    this.news = [];
    this.adminLog = [];
    this.rate = new Map();
    this.lastTriggeredNews = [];

    const history = this.generateHistoricalCandles({
      endDateExclusiveMs: SIM_START_DATE_UTC,
      bars: HISTORY_BARS,
      firstBarPrice: HISTORY_FIRST_BAR_PRICE,
      endingPrice: startFairValue,
    });
    this.last52Candles = history.candles;
    this.market.get('BTC').lastPrice = history.endPrice;
    this.market.get('BTC').previousPrice = history.endPrice;
    this.latestCompletedCandle = null;
    this.lastCandleTimeSec = this.last52Candles.at(-1)?.time ?? null;

    this.persistMarket();
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

  loadFairValueSchedule() {
    const p = path.join(process.cwd(), 'server', 'data', 'fair_value_schedule_2013_2017.json');
    if (!fs.existsSync(p)) throw new Error('Missing fair value schedule file: server/data/fair_value_schedule_2013_2017.json');
    const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
    return rows
      .map((row) => ({ ...row, timeMs: Date.parse(`${row.date}T00:00:00.000Z`) }))
      .sort((a, b) => a.timeMs - b.timeMs);
  }

  fairValueForDateMs(dateMs) {
    const t = dateMs;
    const points = this.fairValueSchedule;
    if (t <= points[0].timeMs) return Number(points[0].fairValueUSD);
    if (t >= points.at(-1).timeMs) return Number(points.at(-1).fairValueUSD);
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (t >= a.timeMs && t <= b.timeMs) {
        const spanDays = Math.max(1, Math.round((b.timeMs - a.timeMs) / DAY_MS));
        const elapsedDays = Math.round((t - a.timeMs) / DAY_MS);
        const ratio = elapsedDays / spanDays;
        return Number((a.fairValueUSD + (b.fairValueUSD - a.fairValueUSD) * ratio).toFixed(6));
      }
    }
    return Number(points.at(-1).fairValueUSD);
  }

  currentSimDateMs() {
    return Math.min(SIM_END_DATE_UTC, SIM_START_DATE_UTC + this.state.tick * DAY_MS);
  }

  simDateISO() { return new Date(this.currentSimDateMs()).toISOString(); }

  partialCurrentDayCandle() {
    const timeSec = Math.floor(this.currentSimDateMs() / 1000);
    const p = this.market.get('BTC').lastPrice;
    return { time: timeSec, open: p, high: p, low: p, close: p };
  }

  initialCandles52() {
    return this.last52Candles;
  }

  computeFairValueReversionProbabilities(marketPrice, fairValue) {
    const devPct = ((marketPrice - fairValue) / fairValue) * 100;
    const absDev = Math.abs(devPct);
    let upProb = 0.5;
    let downProb = 0.5;

    if (absDev > FAIR_VALUE_BAND_PCT) {
      const extra = absDev - FAIR_VALUE_BAND_PCT;
      const shift = extra * FAIR_VALUE_SHIFT_PER_PCT;
      if (devPct < 0) {
        upProb = clamp(0.5 + shift, MIN_PROB, MAX_PROB);
        downProb = clamp(0.5 - shift, MIN_PROB, MAX_PROB);
      } else {
        upProb = clamp(0.5 - shift, MIN_PROB, MAX_PROB);
        downProb = clamp(0.5 + shift, MIN_PROB, MAX_PROB);
      }
    }

    const sum = upProb + downProb;
    upProb /= sum;
    downProb = 1 - upProb;

    invariant(upProb >= MIN_PROB - 1e-9 && upProb <= MAX_PROB + 1e-9, `upProb out of bounds: ${upProb}`);
    invariant(downProb >= MIN_PROB - 1e-9 && downProb <= MAX_PROB + 1e-9, `downProb out of bounds: ${downProb}`);
    invariant(Math.abs((upProb + downProb) - 1) < 1e-9, `probabilities must sum to 1, got ${upProb + downProb}`);

    return { upProb, downProb, devPct };
  }

  simulateIntradayCandle({ dateMs, openingPrice, dailyStepUSD, directionMode = 'fair', historyDownProb = HISTORY_DOWN_PROB, fairValue }) {
    const subStepUSD = Math.max(1, Math.round(dailyStepUSD / Math.sqrt(INTRADAY_STEPS))); // sqrt keeps intraday range lively without exploding variance.
    let price = openingPrice;
    let high = price;
    let low = price;

    for (let i = 0; i < INTRADAY_STEPS; i += 1) {
      let upProb = 0.5;
      if (directionMode === 'history') {
        upProb = 1 - historyDownProb;
      } else {
        upProb = this.computeFairValueReversionProbabilities(price, fairValue).upProb;
      }
      const signed = this.rng() < upProb ? subStepUSD : -subStepUSD;
      price = clampMin(price + signed, EPS);
      high = Math.max(high, price);
      low = Math.min(low, price);
    }

    const candle = {
      time: Math.floor(dateMs / 1000),
      open: Number(openingPrice.toFixed(6)),
      high: Number(high.toFixed(6)),
      low: Number(low.toFixed(6)),
      close: Number(price.toFixed(6)),
    };
    this.assertCandle(candle);
    return candle;
  }

  historicalFairValueForDay({ dayMs, oldestDayMs, endingFairValue }) {
    const rawAtDay = this.fairValueForDateMs(dayMs);
    const rawAtOldest = this.fairValueForDateMs(oldestDayMs);
    const rawAtStart = this.fairValueForDateMs(SIM_START_DATE_UTC);

    if (Math.abs(rawAtOldest - rawAtStart) > EPS) {
      const scale = (HISTORY_FIRST_BAR_PRICE - endingFairValue) / (rawAtOldest - rawAtStart);
      return Number((endingFairValue + (rawAtDay - rawAtStart) * scale).toFixed(6));
    }

    const totalSpan = Math.max(1, Math.round((SIM_START_DATE_UTC - oldestDayMs) / DAY_MS));
    const elapsed = Math.round((dayMs - oldestDayMs) / DAY_MS);
    const ratio = clamp(elapsed / totalSpan, 0, 1);
    return Number((HISTORY_FIRST_BAR_PRICE + (endingFairValue - HISTORY_FIRST_BAR_PRICE) * ratio).toFixed(6));
  }

  generateHistoricalCandles({ endDateExclusiveMs, bars, firstBarPrice = HISTORY_FIRST_BAR_PRICE, endingPrice }) {
    const oldestDayMs = endDateExclusiveMs - bars * DAY_MS;
    const candles = [];
    let openingPrice = firstBarPrice;

    for (let i = 0; i < bars; i += 1) {
      const dayMs = oldestDayMs + i * DAY_MS;
      const fairValue = this.historicalFairValueForDay({
        dayMs,
        oldestDayMs,
        endingFairValue: endingPrice,
      });
      const basisPrice = Math.max(openingPrice, fairValue, EPS);
      const dailyStepUSD = Math.max(1, Math.round(basisPrice * this.dailyStepPct * this.volatilityMultiplier));
      const candle = this.simulateIntradayCandle({
        dateMs: dayMs,
        openingPrice,
        dailyStepUSD,
        directionMode: 'fair',
        fairValue,
      });

      candles.push(candle);
      openingPrice = candle.close;
    }

    if (candles.length) {
      const last = candles[candles.length - 1];
      const close = Number(endingPrice.toFixed(6));
      const high = Number(Math.max(last.high, close, last.open, last.low).toFixed(6));
      const low = Number(Math.min(last.low, close, last.open, last.high).toFixed(6));
      candles[candles.length - 1] = {
        ...last,
        high,
        low,
        close,
      };
      this.assertCandle(candles[candles.length - 1]);
    }

    this.assertCandleTimeSequence(candles.map((c) => c.time));
    return { candles, startPrice: firstBarPrice, endPrice: endingPrice };
  }

  assertCandle(candle) {
    invariant(candle.high >= candle.low, `high < low at ${candle.time}`);
    invariant(candle.open >= candle.low && candle.open <= candle.high, `open outside range at ${candle.time}`);
    invariant(candle.close >= candle.low && candle.close <= candle.high, `close outside range at ${candle.time}`);
  }

  assertCandleTimeSequence(times) {
    if (!IS_DEV) return;
    for (let i = 1; i < times.length; i += 1) {
      invariant(times[i] - times[i - 1] === 86400, `candle time must increment by 1 day (${times[i - 1]} -> ${times[i]})`);
    }
  }

  addPlayer({ socketId, name }) {
    let pid = this.socketToPlayer?.get(socketId);
    if (pid && this.players.has(pid)) {
      this.players.get(pid).socketId = socketId;
      return this.players.get(pid);
    }
    if (!this.socketToPlayer) this.socketToPlayer = new Map();
    if (!this.players) this.players = new Map();
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

  applyScheduledEvents(simDate) {
    while (this.nextScheduledEventIdx < this.scheduledEvents.length && this.scheduledEvents[this.nextScheduledEventIdx].date <= simDate) {
      const ev = this.scheduledEvents[this.nextScheduledEventIdx];
      if (ev.date === simDate) this.triggerEvent(ev);
      this.nextScheduledEventIdx += 1;
    }
  }

  applyEnergyModifiers() {
    this.energy = { ...BASE_ENERGY };
    this.energyModifiers = this.energyModifiers.filter((m) => m.untilTick > this.state.tick);
    for (const mod of this.energyModifiers) this.energy[mod.region] = Math.max(0.02, this.energy[mod.region] + mod.delta);
  }

  simulateCurrentDayCandle() {
    const simDateMs = this.currentSimDateMs();
    const btc = this.market.get('BTC');
    btc.previousPrice = btc.lastPrice;
    btc.fairValue = this.fairValueForDateMs(simDateMs);

    const dailyStepUSD = Math.max(1, Math.round(btc.lastPrice * this.dailyStepPct * this.volatilityMultiplier));
    const candle = this.simulateIntradayCandle({
      dateMs: simDateMs,
      openingPrice: btc.lastPrice,
      dailyStepUSD,
      directionMode: 'fair',
      fairValue: btc.fairValue,
    });
    btc.lastPrice = candle.close;
    btc.updatedAt = Date.now();

    if (this.lastCandleTimeSec != null) invariant(candle.time - this.lastCandleTimeSec === 86400, `daily candle time jump must be 1 day (${this.lastCandleTimeSec} -> ${candle.time})`);
    this.lastCandleTimeSec = candle.time;
    this.latestCompletedCandle = candle;
    return candle;
  }

  stepTick() {
    if (this.state.status !== SIM_STATUS.RUNNING) return;
    if (this.currentSimDateMs() > SIM_END_DATE_UTC) {
      this.end();
      return;
    }

    const simDate = toISODate(this.currentSimDateMs());
    this.applyScheduledEvents(simDate);
    this.applyEnergyModifiers();
    this.simulateCurrentDayCandle();

    for (const p of this.players.values()) this.applyMiningForPlayer(p);

    this.state.tick += 1;
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
    if (Number(payload?.dailyStepPct) > 0) this.dailyStepPct = Number(payload.dailyStepPct);
    if (Number(payload?.volatilityMultiplier) > 0) this.volatilityMultiplier = Number(payload.volatilityMultiplier);
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
        const btcOwned = Number(p.holdings.BTC.qty.toFixed(8));
        const miningMetrics = this.miningMetricsForPlayer(p);
        return {
          playerId: p.id,
          name: p.name,
          cash: Number(p.cashUSD.toFixed(2)),
          netWorth: Number(nw.toFixed(2)),
          pnl: Number((nw - p.startingCash).toFixed(2)),
          btcOwned,
          miningCapacityTHs: Number(miningMetrics.playerHashrateTHs.toFixed(2)),
        };
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
      fairValue: btc.fairValue,
      candle: this.latestCompletedCandle ?? this.partialCurrentDayCandle(),
      ...(includeHistory ? { last52Candles: this.initialCandles52(), partialCandle: this.partialCurrentDayCandle() } : {}),
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
      perAsset: [{ symbol: 'BTC', lastPrice: m.lastPrice, fairValue: m.fairValue, unlocked: true }],
      energyPrices: this.energy,
      stepConfig: { dailyStepPct: this.dailyStepPct, volatilityMultiplier: this.volatilityMultiplier, intradaySteps: INTRADAY_STEPS },
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
    up.run(m.symbol, m.lastPrice, null, 0, -1, Date.now());
  }

  persistSimState() { this.db.prepare('INSERT INTO sim_state(roomId,status,startedAt,tick) VALUES(?,?,?,?) ON CONFLICT(roomId) DO UPDATE SET status=excluded.status,startedAt=excluded.startedAt,tick=excluded.tick').run(ROOM_ID, this.state.status, this.state.startedAt, this.state.tick); }

  logAdmin(msg) { this.adminLog.push({ t: Date.now(), message: msg }); this.adminLog = this.adminLog.slice(-200); }
}
