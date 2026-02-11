import { CLIENT_EVENTS, SERVER_EVENTS } from '/shared/contracts.mjs';
import { createAdminControlChart, createBtcCandleChart, createHashrateLineChart } from '/client/btc-chart.js';

const socket = io();
const $ = (id) => document.getElementById(id);
let latestMarketState = null;
let latestTickers = {};
let latestEnergy = {};
let newsChart = null;
let controlChart = null;
let hashrateChart = null;
let hashratePoints = [];
let leaderboardRows = [];
let leaderboardSort = { key: 'netWorth', direction: 'desc' };

function fmtSimDate(input) { const date = new Date(input); if (Number.isNaN(date.getTime())) return '2013-01-01'; return date.toISOString().slice(0, 10); }

const fmtNumber = (n, d = 2) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtCurrency = (n, d = 2) => `$${fmtNumber(n, d)}`;


function isFullscreenActive() {
  return Boolean(document.fullscreenElement);
}

function updateFullscreenButton() {
  const btn = $('fullscreenBtn');
  if (!btn) return;
  btn.textContent = isFullscreenActive() ? 'Exit Fullscreen' : 'Enter Fullscreen';
}

async function toggleFullscreen() {
  try {
    if (isFullscreenActive()) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  } catch {
    // Ignore browser fullscreen errors (gesture restrictions, unsupported envs).
  } finally {
    updateFullscreenButton();
  }
}

const fullscreenBtn = $('fullscreenBtn');
if (fullscreenBtn) fullscreenBtn.onclick = () => toggleFullscreen();
document.addEventListener('fullscreenchange', updateFullscreenButton);
updateFullscreenButton();


function compareValues(a, b, key) {
  if (key === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
  return Number(a[key] || 0) - Number(b[key] || 0);
}

function sortLeaderboardRows(rows) {
  const dir = leaderboardSort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => compareValues(a, b, leaderboardSort.key) * dir);
}

function renderLeaderboard() {
  if (!$('rows')) return;
  const sorted = sortLeaderboardRows(leaderboardRows);
  $('rows').innerHTML = sorted.map((r, i) => {
    const btcOwned = Number(r.btcOwned || 0);
    const miningCapacityTHs = Number(r.miningCapacityTHs || 0);
    const ytdPnl = Number(r.ytdPnl || 0);
    return `<tr><td>${i + 1}</td><td>${r.name}</td><td>${fmtCurrency(r.netWorth, 2)}</td><td class='${ytdPnl >= 0 ? 'good' : 'bad'}'>${fmtCurrency(ytdPnl, 2)}</td><td class='${r.pnl >= 0 ? 'good' : 'bad'}'>${fmtCurrency(r.pnl, 2)}</td><td>${fmtCurrency(r.cash, 2)}</td><td>${fmtNumber(btcOwned, 8)}</td><td>${fmtNumber(miningCapacityTHs, 2)}</td></tr>`;
  }).join('');

  document.querySelectorAll('th[data-sort]').forEach((th) => {
    const key = th.dataset.sort;
    const active = key === leaderboardSort.key;
    th.classList.toggle('active-sort', active);
    th.dataset.sortDir = active ? leaderboardSort.direction : '';
  });
}

function wireLeaderboardSort() {
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    if (th.dataset.sortInit === '1') return;
    th.dataset.sortInit = '1';
    th.addEventListener('click', () => {
      const nextKey = th.dataset.sort;
      if (!nextKey) return;
      if (leaderboardSort.key === nextKey) {
        leaderboardSort.direction = leaderboardSort.direction === 'desc' ? 'asc' : 'desc';
      } else {
        leaderboardSort = { key: nextKey, direction: nextKey === 'name' ? 'asc' : 'desc' };
      }
      renderLeaderboard();
    });
  });
}

wireLeaderboardSort();

function ensureNewsChart() {
  if (newsChart || !$('btcChart')) return;
  newsChart = createBtcCandleChart($('btcChart'));
}

function ensureControlChart() {
  if (controlChart || !$('btcControlChart')) return;
  controlChart = createAdminControlChart($('btcControlChart'));
}

function ensureHashrateChart() {
  if (hashrateChart || !$('hashrateChart')) return;
  hashrateChart = createHashrateLineChart($('hashrateChart'));
}

function renderHashrateSummary(hashrate) {
  if (!hashrate) return;
  if ($('baseHashrate')) $('baseHashrate').textContent = fmtNumber(hashrate.baseNetworkHashrateTHs, 2);
  if ($('playerHashrate')) $('playerHashrate').textContent = fmtNumber(hashrate.playerNetworkHashrateTHs, 2);
  if ($('totalHashrate')) $('totalHashrate').textContent = fmtNumber(hashrate.totalNetworkHashrateTHs, 2);
}

if ($('go')) $('go').onclick = () => socket.emit(CLIENT_EVENTS.ADMIN_AUTH, { pin: $('pin').value });
socket.on('adminAuthed', () => { if ($('auth')) $('auth').innerHTML = '<span class="good">Admin unlocked</span>'; if ($('adminContent')) $('adminContent').classList.remove('hidden'); if ($('adminNav')) $('adminNav').classList.remove('hidden'); });
socket.on(SERVER_EVENTS.ERROR, ({ message }) => alert(message));

if ($('start')) $('start').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_START);
if ($('pause')) $('pause').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_PAUSE);
if ($('end')) $('end').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_END);
if ($('setTickSpeed')) $('setTickSpeed').onclick = () => socket.emit(CLIENT_EVENTS.ADMIN_SET_TICK_SPEED, { tickMs: Number($('tickSpeed').value) });

socket.on(SERVER_EVENTS.MARKET_TICK, (tick) => {
  ensureNewsChart();
  ensureControlChart();
  ensureHashrateChart();

  if (tick.last52Candles?.length) {
    newsChart?.setInitialCandles(tick.last52Candles);
    controlChart?.setInitialCandles(tick.last52Candles, tick.fairValue);
  }

  if (tick.partialCandle) {
    newsChart?.updateCandle(tick.partialCandle);
    controlChart?.updateValues({
      time: tick.partialCandle.time,
      price: tick.partialCandle.close,
      fairValue: tick.fairValue,
    });
  }

  if (tick.candle) {
    newsChart?.updateCandle(tick.candle);
    controlChart?.updateValues({
      time: tick.candle.time,
      price: tick.candle.close,
      fairValue: tick.fairValue,
    });
  }

  if ($('controlFairValue') && typeof tick.fairValue === 'number') {
    $('controlFairValue').textContent = fmtCurrency(tick.fairValue, 2);
  }

  if (typeof tick.baseNetworkHashrateTHs === 'number') {
    hashratePoints.push({
      simDate: tick.date,
      baseNetworkHashrateTHs: tick.baseNetworkHashrateTHs,
      playerNetworkHashrateTHs: tick.playerNetworkHashrateTHs,
      totalNetworkHashrateTHs: tick.totalNetworkHashrateTHs,
    });
    hashratePoints = hashratePoints.slice(-600);
    hashrateChart?.update(hashratePoints);
    renderHashrateSummary(tick);
  }

});

socket.on(SERVER_EVENTS.LEADERBOARD, ({ rows }) => {
  leaderboardRows = Array.isArray(rows) ? rows : [];
  renderLeaderboard();
});

socket.on(SERVER_EVENTS.NEWS_FEED_UPDATE, ({ events, tickers, energy, simDate }) => {
  latestTickers = tickers || {};
  latestEnergy = energy || {};

  if ($('simDate')) $('simDate').textContent = fmtSimDate(simDate);
  if ($('controlSimDate')) $('controlSimDate').textContent = fmtSimDate(simDate);
  if ($('news')) $('news').innerHTML = events.map((e) => `<div class='asset'><b>${e.date || new Date(e.timestamp).toLocaleTimeString()}</b> ${e.headline}<div class='muted'>${e.body}</div></div>`).join('');

  if ($('cards')) {
    $('cards').innerHTML = `
      <div class='asset'><b>BTC</b><div>${fmtCurrency(latestTickers.BTC?.price || 0, 2)}</div></div>
      <div class='asset'><b>ASIA</b><div>${fmtCurrency(latestEnergy.ASIA || 0, 3)}/kWh</div></div>
      <div class='asset'><b>EUROPE</b><div>${fmtCurrency(latestEnergy.EUROPE || 0, 3)}/kWh</div></div>
      <div class='asset'><b>AMERICA</b><div>${fmtCurrency(latestEnergy.AMERICA || 0, 3)}/kWh</div></div>
    `;
  }

  if ($('ticker')) {
    const prev = Number(latestTickers.BTC?.previous || latestTickers.BTC?.price || 0);
    const now = Number(latestTickers.BTC?.price || 0);
    const pct = prev > 0 ? ((now - prev) / prev) * 100 : 0;
    $('ticker').innerHTML = `BTC ${fmtCurrency(now, 2)} (${pct >= 0 ? '+' : ''}${fmtNumber(pct, 2)}%) • Date ${fmtSimDate(simDate)} • ASIA:${fmtCurrency(latestEnergy.ASIA || 0, 3)} • EUROPE:${fmtCurrency(latestEnergy.EUROPE || 0, 3)} • AMERICA:${fmtCurrency(latestEnergy.AMERICA || 0, 3)}`;
  }
});

socket.on(SERVER_EVENTS.NEWS_EVENT_TRIGGERED, (e) => {
  if (!$('news')) return;
  const item = document.createElement('div');
  item.className = 'asset';
  item.innerHTML = `<b>${e.date}</b> ${e.headline}<div class='muted'>${e.body}</div>`;
  $('news').prepend(item);
});

socket.on(SERVER_EVENTS.ADMIN_MARKET_STATE, (s) => {
  latestMarketState = s;
  if ($('positions')) $('positions').textContent = JSON.stringify(s.positionsSummary, null, 2);
  if ($('controlFairValue')) $('controlFairValue').textContent = fmtCurrency(s.perAsset?.[0]?.fairValue || 0, 2);
  if ($('dailyStepPct') && s.stepConfig?.dailyStepPct) $('dailyStepPct').value = String(s.stepConfig.dailyStepPct);
  if ($('volatilityMultiplier') && s.stepConfig?.volatilityMultiplier) $('volatilityMultiplier').value = String(s.stepConfig.volatilityMultiplier);
  if ($('elog')) $('elog').textContent = s.eventLog.map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.message}`).join('\n');
  if ($('tickSpeed')) $('tickSpeed').value = String(s.simState.tickMs || 1000);
  ensureHashrateChart();
  if (Array.isArray(s.hashrateHistory)) {
    hashratePoints = s.hashrateHistory.slice(-600);
    hashrateChart?.update(hashratePoints);
  }
  renderHashrateSummary(s.simState);
  if ($('energyControls')) {
    $('energyControls').innerHTML = Object.entries(s.energyPrices).map(([r, v]) => `<div class='row'><span style='width:80px'>${r}</span><input type='number' step='0.001' data-energy='${r}' value='${v}'/></div>`).join('');
  }
});

if ($('applyParams')) {
  $('applyParams').onclick = () => {
    if (!latestMarketState) return;
    const energy = Object.keys(latestMarketState.energyPrices).map((r) => ({ region: r, energyPriceUSD: Number(document.querySelector(`[data-energy='${r}']`).value) }));
    const dailyStepPct = Number($('dailyStepPct')?.value || 0);
    const volatilityMultiplier = Number($('volatilityMultiplier')?.value || 0);
    socket.emit(CLIENT_EVENTS.ADMIN_UPDATE_MARKET, { energy, dailyStepPct, volatilityMultiplier });
  };
}
