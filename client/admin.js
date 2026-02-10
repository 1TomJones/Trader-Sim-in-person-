import { CLIENT_EVENTS, SERVER_EVENTS } from '/shared/contracts.mjs';

const socket = io();
const $ = (id) => document.getElementById(id);
let latestMarketState = null;
let latestTickers = {};
let latestEnergy = {};
let livePricesInterval = null;
let unlockedAssets = {};

const PRICE_GROUPS = [
  { name: 'BTC + Unlocked Majors', symbols: ['BTC', 'ETH', 'BNB', 'XRP', 'SOL'] },
  { name: 'Unlocked Memes', symbols: ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK'] },
  { name: 'Energy', symbols: ['ASIA', 'EUROPE', 'AMERICA'], type: 'energy' },
];

let livePricesGroupIndex = 0;
let btcChart;
let btcSeries;
const btcWeeklyBars = new Map();

function fmtSimDate(input) { const date = new Date(input); if (Number.isNaN(date.getTime())) return '2015-01-01'; return date.toISOString().slice(0, 10); }
function getWeekStart(date) { const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const day = weekStart.getUTCDay(); const diff = (day + 6) % 7; weekStart.setUTCDate(weekStart.getUTCDate() - diff); weekStart.setUTCHours(0, 0, 0, 0); return weekStart; }

function initBtcChart() {
  if (!window.LightweightCharts || !$('btcChart') || btcChart) return;
  btcChart = window.LightweightCharts.createChart($('btcChart'), {
    autoSize: true,
    layout: { background: { color: '#0d1428' }, textColor: '#f7f9ff' },
    grid: { vertLines: { color: '#1f2b48' }, horzLines: { color: '#1f2b48' } },
    rightPriceScale: { borderColor: '#2b3a60' },
    timeScale: { borderColor: '#2b3a60', rightOffset: 2 },
  });
  btcSeries = btcChart.addCandlestickSeries({ upColor: '#32d296', downColor: '#ff6b6b', borderUpColor: '#32d296', borderDownColor: '#ff6b6b', wickUpColor: '#32d296', wickDownColor: '#ff6b6b' });
}

function updateBtcChart(simDate, btcPrice) {
  if (!Number.isFinite(btcPrice)) return;
  initBtcChart();
  if (!btcSeries) return;
  const date = new Date(simDate);
  const weekStart = getWeekStart(date);
  const weekKey = weekStart.toISOString();
  const bar = btcWeeklyBars.get(weekKey);
  if (!bar) btcWeeklyBars.set(weekKey, { time: Math.floor(weekStart.getTime() / 1000), open: btcPrice, high: btcPrice, low: btcPrice, close: btcPrice });
  else { bar.high = Math.max(bar.high, btcPrice); bar.low = Math.min(bar.low, btcPrice); bar.close = btcPrice; }
  btcSeries.setData([...btcWeeklyBars.values()].sort((a, b) => a.time - b.time).slice(-52));
  btcChart.timeScale().fitContent();
}

function renderLivePrices() {
  if (!$('cards') || !$('livePricesGroup')) return;
  const group = PRICE_GROUPS[livePricesGroupIndex % PRICE_GROUPS.length];
  $('livePricesGroup').textContent = group.name;
  if (group.type === 'energy') {
    $('cards').innerHTML = REGIONS_RENDER.map((r) => `<div class='asset'><b>${r}</b><div>$${Number(latestEnergy[r] ?? NaN).toFixed(3)}/kWh</div></div>`).join('');
    return;
  }
  $('cards').innerHTML = group.symbols.filter((s) => s === 'BTC' || unlockedAssets[s]).map((symbol) => {
    const price = latestTickers[symbol]?.price;
    const rendered = Number.isFinite(price) ? `$${price.toFixed(6)}` : '—';
    return `<div class='asset'><b>${symbol}</b><div>${rendered}</div></div>`;
  }).join('');
}
const REGIONS_RENDER = ['ASIA', 'EUROPE', 'AMERICA'];

function startLivePricesRotation() { if (livePricesInterval) return; livePricesInterval = setInterval(() => { livePricesGroupIndex = (livePricesGroupIndex + 1) % PRICE_GROUPS.length; renderLivePrices(); }, 5000); }

if ($('go')) $('go').onclick = () => socket.emit(CLIENT_EVENTS.ADMIN_AUTH, { pin: $('pin').value });
socket.on('adminAuthed', () => { if ($('auth')) $('auth').innerHTML = '<span class="good">Admin unlocked</span>'; if ($('adminContent')) $('adminContent').classList.remove('hidden'); if ($('adminNav')) $('adminNav').classList.remove('hidden'); });
socket.on(SERVER_EVENTS.ERROR, ({ message }) => alert(message));

if ($('start')) $('start').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_START);
if ($('pause')) $('pause').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_PAUSE);
if ($('end')) $('end').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_END);
if ($('setTickSpeed')) $('setTickSpeed').onclick = () => socket.emit(CLIENT_EVENTS.ADMIN_SET_TICK_SPEED, { tickMs: Number($('tickSpeed').value) });

socket.on(SERVER_EVENTS.LEADERBOARD, ({ rows }) => {
  if (!$('rows')) return;
  $('rows').innerHTML = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>$${r.netWorth.toFixed(2)}</td><td class='${r.pnl >= 0 ? 'good' : 'bad'}'>$${r.pnl.toFixed(2)}</td><td>$${r.cash.toFixed(2)}</td></tr>`).join('');
});

socket.on(SERVER_EVENTS.NEWS_FEED_UPDATE, ({ events, tickers, energy, simDate, unlockedAssets: ua }) => {
  latestTickers = tickers || {};
  latestEnergy = energy || {};
  unlockedAssets = ua || unlockedAssets;

  if ($('simDate')) $('simDate').textContent = fmtSimDate(simDate);
  if ($('controlSimDate')) $('controlSimDate').textContent = fmtSimDate(simDate);
  if ($('news')) $('news').innerHTML = events.map((e) => `<div class='asset'><b>${e.date || new Date(e.timestamp).toLocaleTimeString()}</b> ${e.headline}<div class='muted'>${e.body}</div></div>`).join('');
  renderLivePrices();
  startLivePricesRotation();

  const btcPrice = Number(latestTickers.BTC?.price);
  updateBtcChart(simDate, btcPrice);

  if ($('ticker')) {
    const topUnlocked = Object.keys(unlockedAssets).filter((s) => unlockedAssets[s]).slice(0, 6).map((s) => `${s} $${Number(latestTickers[s]?.price || 0).toFixed(4)}`).join(' • ');
    $('ticker').innerHTML = `BTC $${Number(latestTickers.BTC?.price || 0).toFixed(2)} • ASIA:$${Number(latestEnergy.ASIA || 0).toFixed(3)} • EU:$${Number(latestEnergy.EUROPE || 0).toFixed(3)} • US:$${Number(latestEnergy.AMERICA || 0).toFixed(3)} • ${topUnlocked}`;
  }
});

socket.on(SERVER_EVENTS.ADMIN_MARKET_STATE, (s) => {
  latestMarketState = s;
  if ($('positions')) $('positions').textContent = JSON.stringify(s.positionsSummary, null, 2);
  if ($('elog')) $('elog').textContent = s.eventLog.map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.message}`).join('\n');
  if ($('tickSpeed')) $('tickSpeed').value = String(s.simState.tickMs || 1000);
  if ($('assetControls')) {
    $('assetControls').innerHTML = s.perAsset.map((a) => `<div class='row'><span style='width:52px'>${a.symbol}</span><span class='muted'>${a.unlocked ? 'open' : 'locked'}</span><select data-dir='${a.symbol}'><option>UP</option><option>DOWN</option></select><input type='number' step='0.01' data-strength='${a.symbol}' value='0.65'/><input type='number' data-adur='${a.symbol}' value='15'/><label><input type='checkbox' data-reset='${a.symbol}'/>Reset</label></div>`).join('');
  }
  if ($('energyControls')) {
    $('energyControls').innerHTML = Object.entries(s.energyPrices).map(([r, v]) => `<div class='row'><span style='width:80px'>${r}</span><input type='number' step='0.001' data-energy='${r}' value='${v}'/></div>`).join('');
  }
  if ($('affected')) $('affected').innerHTML = s.perAsset.map((a) => `<option value='${a.symbol}'>${a.symbol}</option>`).join('');
});

if ($('applyParams')) {
  $('applyParams').onclick = () => {
    if (!latestMarketState) return;
    const assets = latestMarketState.perAsset.map((a) => ({
      symbol: a.symbol,
      manualBias: { direction: document.querySelector(`[data-dir='${a.symbol}']`).value, strength: Number(document.querySelector(`[data-strength='${a.symbol}']`).value), durationDays: Number(document.querySelector(`[data-adur='${a.symbol}']`).value) },
      resetBias: document.querySelector(`[data-reset='${a.symbol}']`).checked,
    }));
    const energy = Object.keys(latestMarketState.energyPrices).map((r) => ({ region: r, energyPriceUSD: Number(document.querySelector(`[data-energy='${r}']`).value) }));
    socket.emit(CLIENT_EVENTS.ADMIN_UPDATE_MARKET, { assets, energy });
  };
}

if ($('createNews')) {
  $('createNews').onclick = () => {
    const selected = [...$('affected').selectedOptions].map((o) => o.value);
    const delta = Number($('edelta').value || 0);
    socket.emit(CLIENT_EVENTS.ADMIN_CREATE_NEWS, {
      headline: $('headline').value,
      body: $('body').value,
      affectedAssets: selected,
      durationSec: Number($('dur').value),
      severity: 'MEDIUM',
      biasConfig: { direction: $('direction').value, strength: Number($('strength').value) },
      energyConfig: delta ? { changes: [{ region: $('ereg').value, delta }] } : null,
    });
  };
}
