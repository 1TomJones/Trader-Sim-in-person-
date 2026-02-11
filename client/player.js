import { CLIENT_EVENTS, SERVER_EVENTS, SIM_STATUS } from '/shared/contracts.mjs';
import { createBtcCandleChart } from '/client/btc-chart.js';

const socket = io();
let me = null;
let hasJoined = false;
let latestLobbyStatus = SIM_STATUS.LOBBY;
let latestTick = null;
let btcChart = null;

const $ = (id) => document.getElementById(id);
const fmtDate = (d) => new Date(d).toISOString().slice(0, 10);
const fmtNumber = (n, d = 2) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtCurrency = (n, d = 2) => `$${fmtNumber(n, d)}`;

function showPlayerJoin() { $('joinScreen').classList.remove('hidden'); $('waitScreen').classList.add('hidden'); $('app').classList.add('hidden'); }
function showPlayerWait() { $('joinScreen').classList.add('hidden'); $('waitScreen').classList.remove('hidden'); $('app').classList.add('hidden'); }
function showPlayerApp() { $('joinScreen').classList.add('hidden'); $('waitScreen').classList.add('hidden'); $('app').classList.remove('hidden'); }

fetch('/api/bootstrap').then((r) => r.json()).then((b) => {
  $('rigType').innerHTML = Object.values(b.rigCatalog).map((r) => `<option value='${r.key}'>${r.name} (${fmtNumber(r.hashrateTHs, 2)} TH/s • ${fmtCurrency(r.purchasePrice)})</option>`).join('');
  $('rigRegion').innerHTML = b.regions.map((r) => `<option>${r}</option>`).join('');
});

function ensureChart() {
  if (btcChart) return;
  btcChart = createBtcCandleChart($('playerBtcChart'));
}

$('join').onclick = () => {
  socket.emit(CLIENT_EVENTS.JOIN_ROOM, { name: $('name').value, roomCode: $('room').value, playerId: localStorage.getItem('playerId') });
};
socket.on('joined', ({ playerId }) => { localStorage.setItem('playerId', playerId); hasJoined = true; if (latestLobbyStatus === SIM_STATUS.RUNNING) showPlayerApp(); else showPlayerWait(); });
socket.on(SERVER_EVENTS.ERROR, ({ message }) => alert(message));

socket.on(SERVER_EVENTS.LOBBY_STATE, ({ players, status }) => {
  latestLobbyStatus = status;
  $('status').textContent = status;
  $('players').textContent = `Players waiting: ${players.map((p) => p.name).join(', ') || 'None yet'}`;
  if (!hasJoined) return showPlayerJoin();
  if (status === SIM_STATUS.RUNNING) showPlayerApp(); else showPlayerWait();
});

socket.on(SERVER_EVENTS.MARKET_TICK, (tick) => {
  latestTick = tick;
  $('simDate').textContent = tick.date;
  $('btcPx').textContent = fmtCurrency(tick.btcPrice, 2);
  ensureChart();
  if (tick.last52Candles?.length) btcChart?.setInitialCandles(tick.last52Candles);
  if (tick.partialCandle) btcChart?.updateCandle(tick.partialCandle);
  if (tick.candle) btcChart?.updateCandle(tick.candle);
  renderMineMetrics();
  renderTradeEstimate();
});

socket.on(SERVER_EVENTS.PLAYER_STATE, (p) => {
  me = p;
  $('simDate').textContent = fmtDate(p.simDate);
  renderPlayer();
  renderMineMetrics();
});

function renderPlayer() {
  if (!me) return;
  $('cash').textContent = fmtCurrency(me.cash);
  $('nw').textContent = fmtCurrency(me.netWorth);
  $('pnl').textContent = fmtCurrency(me.pnl);
  $('btcQty').textContent = fmtNumber(me.btcQty, 6);
  $('avgEntry').textContent = fmtCurrency(me.avgEntry, 2);
  $('uPnL').textContent = fmtCurrency(me.unrealizedPnL, 2);
  $('rPnL').textContent = fmtCurrency(me.realizedPnL, 2);
  $('negWarn').classList.toggle('hidden', me.cash >= 0);
  $('buy').disabled = me.cash <= 0;
  $('buyRig').disabled = me.cash <= 0;
}

function renderTradeEstimate() {
  const qty = Number($('qty').value || 0);
  const px = Number(latestTick?.btcPrice || 0);
  $('usdEstimate').textContent = fmtCurrency(qty * px, 2);
}

function renderMineMetrics() {
  if (!me?.miningMetrics) return;
  const m = me.miningMetrics;
  $('mineMetrics').innerHTML = `
    <div class='asset'><b>Hashrate</b><div>Player: ${fmtNumber(m.playerHashrateTHs, 2)} TH/s</div><div>Network: ${fmtNumber(m.networkHashrateTHs, 2)} TH/s</div><div>Share: ${fmtNumber(m.playerSharePct, 6)}%</div></div>
    <div class='asset'><b>Production</b><div>BTC/day: ${fmtNumber(m.btcMinedPerDay, 6)}</div><div>USD/day: ${fmtCurrency(m.usdMinedPerDay, 2)}</div><div>Block reward: ${fmtNumber(m.blockRewardBTC, 2)} BTC</div></div>
    <div class='asset'><b>Power + Cost</b><div>Power draw: ${fmtNumber(m.totalPowerDrawKW, 2)} kW</div><div>Energy/day: ${fmtCurrency(m.dailyEnergyCostUSD, 2)}</div><div>Net/day: ${fmtCurrency(m.netMiningProfitUSDPerDay, 2)}</div></div>
    <div class='asset'><b>Energy Prices</b><div>ASIA: ${fmtCurrency(m.energyPrices.ASIA, 3)}/kWh</div><div>EUROPE: ${fmtCurrency(m.energyPrices.EUROPE, 3)}/kWh</div><div>AMERICA: ${fmtCurrency(m.energyPrices.AMERICA, 3)}/kWh</div></div>
  `;
}

$('qty').oninput = renderTradeEstimate;
$('buy').onclick = () => socket.emit(CLIENT_EVENTS.BUY_CRYPTO, { symbol: 'BTC', qty: Number($('qty').value) });
$('sell').onclick = () => socket.emit(CLIENT_EVENTS.SELL_CRYPTO, { symbol: 'BTC', qty: Number($('qty').value) });
$('buyRig').onclick = () => socket.emit(CLIENT_EVENTS.BUY_RIG, { region: $('rigRegion').value, rigType: $('rigType').value, count: Number($('rigCount').value) });
$('sellRig').onclick = () => socket.emit(CLIENT_EVENTS.SELL_RIG, { region: $('rigRegion').value, rigType: $('rigType').value, count: 1 });

$('tradeTab').onclick = () => { $('tradeView').classList.remove('hidden'); $('mineView').classList.add('hidden'); $('tradeTab').className = 'btn tab'; $('mineTab').className = 'btn alt tab'; };
$('mineTab').onclick = () => { $('mineView').classList.remove('hidden'); $('tradeView').classList.add('hidden'); $('mineTab').className = 'btn tab'; $('tradeTab').className = 'btn alt tab'; };
