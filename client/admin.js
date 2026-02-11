import { CLIENT_EVENTS, SERVER_EVENTS } from '/shared/contracts.mjs';
import { createAdminControlChart, createBtcCandleChart } from '/client/btc-chart.js';

const socket = io();
const $ = (id) => document.getElementById(id);
let latestMarketState = null;
let latestTickers = {};
let latestEnergy = {};
let newsChart = null;
let controlChart = null;

function fmtSimDate(input) { const date = new Date(input); if (Number.isNaN(date.getTime())) return '2013-01-01'; return date.toISOString().slice(0, 10); }

function ensureNewsChart() {
  if (newsChart || !$('btcChart')) return;
  newsChart = createBtcCandleChart($('btcChart'));
}

function ensureControlChart() {
  if (controlChart || !$('btcControlChart')) return;
  controlChart = createAdminControlChart($('btcControlChart'));
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
    $('controlFairValue').textContent = `$${Number(tick.fairValue).toFixed(2)}`;
  }
});

socket.on(SERVER_EVENTS.LEADERBOARD, ({ rows }) => {
  if (!$('rows')) return;
  $('rows').innerHTML = rows.map((r, i) => {
    const btcOwned = Number(r.btcOwned || 0);
    const miningCapacityTHs = Number(r.miningCapacityTHs || 0);
    return `<tr><td>${i + 1}</td><td>${r.name}</td><td>$${r.netWorth.toFixed(2)}</td><td class='${r.pnl >= 0 ? 'good' : 'bad'}'>$${r.pnl.toFixed(2)}</td><td>$${r.cash.toFixed(2)}</td><td>${btcOwned.toFixed(8)}</td><td>${miningCapacityTHs.toFixed(2)}</td></tr>`;
  }).join('');
});

socket.on(SERVER_EVENTS.NEWS_FEED_UPDATE, ({ events, tickers, energy, simDate }) => {
  latestTickers = tickers || {};
  latestEnergy = energy || {};

  if ($('simDate')) $('simDate').textContent = fmtSimDate(simDate);
  if ($('controlSimDate')) $('controlSimDate').textContent = fmtSimDate(simDate);
  if ($('news')) $('news').innerHTML = events.map((e) => `<div class='asset'><b>${e.date || new Date(e.timestamp).toLocaleTimeString()}</b> ${e.headline}<div class='muted'>${e.body}</div></div>`).join('');

  if ($('cards')) {
    $('cards').innerHTML = `
      <div class='asset'><b>BTC</b><div>$${Number(latestTickers.BTC?.price || 0).toFixed(2)}</div></div>
      <div class='asset'><b>ASIA</b><div>$${Number(latestEnergy.ASIA || 0).toFixed(3)}/kWh</div></div>
      <div class='asset'><b>EUROPE</b><div>$${Number(latestEnergy.EUROPE || 0).toFixed(3)}/kWh</div></div>
      <div class='asset'><b>AMERICA</b><div>$${Number(latestEnergy.AMERICA || 0).toFixed(3)}/kWh</div></div>
    `;
  }

  if ($('ticker')) {
    const prev = Number(latestTickers.BTC?.previous || latestTickers.BTC?.price || 0);
    const now = Number(latestTickers.BTC?.price || 0);
    const pct = prev > 0 ? ((now - prev) / prev) * 100 : 0;
    $('ticker').innerHTML = `BTC $${now.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) • Date ${fmtSimDate(simDate)} • ASIA:$${Number(latestEnergy.ASIA || 0).toFixed(3)} • EUROPE:$${Number(latestEnergy.EUROPE || 0).toFixed(3)} • AMERICA:$${Number(latestEnergy.AMERICA || 0).toFixed(3)}`;
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
  if ($('controlFairValue')) $('controlFairValue').textContent = `$${Number(s.perAsset?.[0]?.fairValue || 0).toFixed(2)}`;
  if ($('dailyStepPct') && s.stepConfig?.dailyStepPct) $('dailyStepPct').value = String(s.stepConfig.dailyStepPct);
  if ($('volatilityMultiplier') && s.stepConfig?.volatilityMultiplier) $('volatilityMultiplier').value = String(s.stepConfig.volatilityMultiplier);
  if ($('elog')) $('elog').textContent = s.eventLog.map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.message}`).join('\n');
  if ($('tickSpeed')) $('tickSpeed').value = String(s.simState.tickMs || 1000);
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
