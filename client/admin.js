import { CLIENT_EVENTS, SERVER_EVENTS } from '/shared/contracts.mjs';

const socket = io();
const $ = (id) => document.getElementById(id);
let latestMarketState = null;

const PRICE_GROUPS = [
  { name: 'Cryptos', symbols: ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'] },
  { name: 'Meme Coins', symbols: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK'] },
  { name: 'Energy', symbols: ['EUROPE', 'AMERICA'], type: 'energy' },
];

let livePricesGroupIndex = 0;
let latestTickers = {};
let latestEnergy = {};
let livePricesInterval = null;

let btcChart;
let btcSeries;
const btcWeeklyBars = new Map();

function fmtSimDate(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return 'January 1, 2015';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function getWeekStart(date) {
  const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = weekStart.getUTCDay();
  const diff = (day + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - diff);
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart;
}

function initBtcChart() {
  if (!window.LightweightCharts || !$('btcChart') || btcChart) return;
  btcChart = window.LightweightCharts.createChart($('btcChart'), {
    autoSize: true,
    layout: { background: { color: '#0d1428' }, textColor: '#f7f9ff' },
    grid: { vertLines: { color: '#1f2b48' }, horzLines: { color: '#1f2b48' } },
    rightPriceScale: { borderColor: '#2b3a60' },
    timeScale: { borderColor: '#2b3a60', rightOffset: 2 },
    crosshair: { mode: 0 },
  });
  btcSeries = btcChart.addCandlestickSeries({
    upColor: '#32d296',
    downColor: '#ff6b6b',
    borderUpColor: '#32d296',
    borderDownColor: '#ff6b6b',
    wickUpColor: '#32d296',
    wickDownColor: '#ff6b6b',
  });

  if (window.ResizeObserver) {
    const obs = new ResizeObserver(() => btcChart?.timeScale().fitContent());
    obs.observe($('btcChart'));
  }
}

function updateBtcChart(simDate, btcPrice) {
  if (!Number.isFinite(btcPrice)) return;
  initBtcChart();
  if (!btcSeries) return;

  const date = new Date(simDate);
  if (Number.isNaN(date.getTime())) return;
  const weekStart = getWeekStart(date);
  const weekKey = weekStart.toISOString();
  const bar = btcWeeklyBars.get(weekKey);

  if (!bar) {
    btcWeeklyBars.set(weekKey, {
      time: Math.floor(weekStart.getTime() / 1000),
      open: btcPrice,
      high: btcPrice,
      low: btcPrice,
      close: btcPrice,
    });
  } else {
    bar.high = Math.max(bar.high, btcPrice);
    bar.low = Math.min(bar.low, btcPrice);
    bar.close = btcPrice;
  }

  const bars = [...btcWeeklyBars.values()].sort((a, b) => a.time - b.time).slice(-52);
  btcSeries.setData(bars);
  btcChart.timeScale().fitContent();
}

function renderLivePrices() {
  if (!$('cards') || !$('livePricesGroup')) return;
  const group = PRICE_GROUPS[livePricesGroupIndex % PRICE_GROUPS.length];
  $('livePricesGroup').textContent = group.name;

  if (group.type === 'energy') {
    $('cards').innerHTML = [
      `<div class='asset'><b>EU Energy</b><div>$${Number(latestEnergy.EUROPE ?? NaN).toFixed(3)}/kWh</div></div>`,
      `<div class='asset'><b>US Energy</b><div>$${Number(latestEnergy.AMERICA ?? NaN).toFixed(3)}/kWh</div></div>`,
    ].join('');
    return;
  }

  $('cards').innerHTML = group.symbols
    .map((symbol) => {
      const price = latestTickers[symbol]?.price;
      const rendered = Number.isFinite(price) ? `$${price.toFixed(6)}` : '—';
      return `<div class='asset'><b>${symbol}</b><div>${rendered}</div></div>`;
    })
    .join('');
}

function startLivePricesRotation() {
  if (livePricesInterval) return;
  livePricesInterval = setInterval(() => {
    livePricesGroupIndex = (livePricesGroupIndex + 1) % PRICE_GROUPS.length;
    renderLivePrices();
  }, 5000);
}

if ($('go')) {
  $('go').onclick = () => socket.emit(CLIENT_EVENTS.ADMIN_AUTH, { pin: $('pin').value });
}

socket.on('adminAuthed', () => {
  if ($('auth')) $('auth').innerHTML = '<span class="good">Admin unlocked</span>';
  if ($('adminContent')) $('adminContent').classList.remove('hidden');
  if ($('adminNav')) $('adminNav').classList.remove('hidden');
});

socket.on(SERVER_EVENTS.ERROR, ({ message }) => alert(message));

if ($('start')) $('start').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_START);
if ($('pause')) $('pause').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_PAUSE);
if ($('end')) $('end').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_END);

socket.on(SERVER_EVENTS.LEADERBOARD, ({ rows }) => {
  if (!$('rows')) return;
  $('rows').innerHTML = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>$${r.netWorth.toFixed(2)}</td><td class='${r.pnl >= 0 ? 'good' : 'bad'}'>$${r.pnl.toFixed(2)}</td><td>$${r.cash.toFixed(2)}</td></tr>`).join('');
});

socket.on(SERVER_EVENTS.NEWS_FEED_UPDATE, ({ events, tickers, energy, simDate }) => {
  latestTickers = tickers || {};
  latestEnergy = energy || {};

  if ($('simDate')) $('simDate').textContent = fmtSimDate(simDate);
  if ($('news')) $('news').innerHTML = events.map((e) => `<div class='asset'><b>${new Date(e.timestamp).toLocaleTimeString()}</b> ${e.headline}<div class='muted'>${e.body}</div></div>`).join('');
  renderLivePrices();
  startLivePricesRotation();

  const btcPrice = Number(latestTickers.BTC?.price);
  updateBtcChart(simDate, btcPrice);

  if ($('ticker')) $('ticker').innerHTML = Object.entries(latestTickers).slice(0, 7).map(([k, v]) => `${k} $${v.price.toFixed(6)}`).join(' • ') + ` • EU:$${Number(latestEnergy.EUROPE ?? NaN).toFixed(3)} • US:$${Number(latestEnergy.AMERICA ?? NaN).toFixed(3)}`;
});

socket.on(SERVER_EVENTS.ADMIN_MARKET_STATE, (s) => {
  latestMarketState = s;
  if ($('positions')) $('positions').textContent = JSON.stringify(s.positionsSummary, null, 2);
  if ($('elog')) $('elog').textContent = s.eventLog.map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.message}`).join('\n');
  if ($('assetControls')) {
    $('assetControls').innerHTML = s.perAsset.map((a) => `<div class='row'><span style='width:48px'>${a.symbol}</span><input type='number' step='any' data-tick='${a.symbol}' value='${a.tickSize}'/><select data-dir='${a.symbol}'><option>UP</option><option>DOWN</option></select><input type='number' step='0.01' data-strength='${a.symbol}' value='0.65'/><input type='number' data-adur='${a.symbol}' value='120'/><label><input type='checkbox' data-reset='${a.symbol}'/>Reset</label></div>`).join('');
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
      tickSize: Number(document.querySelector(`[data-tick='${a.symbol}']`).value),
      manualBias: {
        direction: document.querySelector(`[data-dir='${a.symbol}']`).value,
        strength: Number(document.querySelector(`[data-strength='${a.symbol}']`).value),
        durationSec: Number(document.querySelector(`[data-adur='${a.symbol}']`).value),
      },
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
