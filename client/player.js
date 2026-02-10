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
const fmt = (n, d = 2) => Number(n || 0).toFixed(d);

function showPlayerJoin() { $('joinScreen').classList.remove('hidden'); $('waitScreen').classList.add('hidden'); $('app').classList.add('hidden'); }
function showPlayerWait() { $('joinScreen').classList.add('hidden'); $('waitScreen').classList.remove('hidden'); $('app').classList.add('hidden'); }
function showPlayerApp() { $('joinScreen').classList.add('hidden'); $('waitScreen').classList.add('hidden'); $('app').classList.remove('hidden'); }

fetch('/api/bootstrap').then((r) => r.json()).then((b) => {
  $('rigType').innerHTML = Object.values(b.rigCatalog).map((r) => `<option value='${r.key}'>${r.name} ($${r.purchasePrice})</option>`).join('');
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
  $('btcPx').textContent = `$${fmt(tick.btcPrice, 2)}`;
  ensureChart();
  if (tick.last52Candles?.length) btcChart?.setInitialCandles(tick.last52Candles);
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
  $('cash').textContent = `$${fmt(me.cash)}`;
  $('nw').textContent = `$${fmt(me.netWorth)}`;
  $('pnl').textContent = `$${fmt(me.pnl)}`;
  $('btcQty').textContent = fmt(me.btcQty, 6);
  $('avgEntry').textContent = `$${fmt(me.avgEntry, 2)}`;
  $('uPnL').textContent = `$${fmt(me.unrealizedPnL, 2)}`;
  $('rPnL').textContent = `$${fmt(me.realizedPnL, 2)}`;
  $('negWarn').classList.toggle('hidden', me.cash >= 0);
  $('buy').disabled = me.cash <= 0;
  $('buyRig').disabled = me.cash <= 0;
}

function renderTradeEstimate() {
  const qty = Number($('qty').value || 0);
  const px = Number(latestTick?.btcPrice || 0);
  $('usdEstimate').textContent = `$${fmt(qty * px, 2)}`;
}

function renderMineMetrics() {
  if (!me?.miningMetrics) return;
  const m = me.miningMetrics;
  $('mineMetrics').innerHTML = `
    <div class='asset'><b>Hashrate</b><div>Player: ${fmt(m.playerHashrateTHs, 2)} TH/s</div><div>Network: ${fmt(m.networkHashrateTHs, 2)} TH/s</div><div>Share: ${fmt(m.playerSharePct, 6)}%</div></div>
    <div class='asset'><b>Production</b><div>BTC/day: ${fmt(m.btcMinedPerDay, 6)}</div><div>USD/day: $${fmt(m.usdMinedPerDay, 2)}</div><div>Block reward: ${fmt(m.blockRewardBTC, 2)} BTC</div></div>
    <div class='asset'><b>Power + Cost</b><div>Power draw: ${fmt(m.totalPowerDrawKW, 2)} kW</div><div>Energy/day: $${fmt(m.dailyEnergyCostUSD, 2)}</div><div>Net/day: $${fmt(m.netMiningProfitUSDPerDay, 2)}</div></div>
    <div class='asset'><b>Difficulty/Halving</b><div>Difficulty index: ${fmt(m.difficultyIndex, 2)}</div><div>Next halving: ${m.nextHalvingCountdownDays == null ? 'Already occurred' : `${m.nextHalvingCountdownDays} days`}</div></div>
    <div class='asset'><b>Energy Prices</b><div>ASIA: $${fmt(m.energyPrices.ASIA, 3)}/kWh</div><div>EUROPE: $${fmt(m.energyPrices.EUROPE, 3)}/kWh</div><div>AMERICA: $${fmt(m.energyPrices.AMERICA, 3)}/kWh</div></div>
  `;
}

$('qty').oninput = renderTradeEstimate;
$('buy').onclick = () => socket.emit(CLIENT_EVENTS.BUY_CRYPTO, { symbol: 'BTC', qty: Number($('qty').value) });
$('sell').onclick = () => socket.emit(CLIENT_EVENTS.SELL_CRYPTO, { symbol: 'BTC', qty: Number($('qty').value) });
$('buyRig').onclick = () => socket.emit(CLIENT_EVENTS.BUY_RIG, { region: $('rigRegion').value, rigType: $('rigType').value, count: Number($('rigCount').value) });
$('sellRig').onclick = () => socket.emit(CLIENT_EVENTS.SELL_RIG, { region: $('rigRegion').value, rigType: $('rigType').value, count: 1 });

$('tradeTab').onclick = () => { $('tradeView').classList.remove('hidden'); $('mineView').classList.add('hidden'); $('tradeTab').className = 'btn tab'; $('mineTab').className = 'btn alt tab'; };
$('mineTab').onclick = () => { $('mineView').classList.remove('hidden'); $('tradeView').classList.add('hidden'); $('mineTab').className = 'btn tab'; $('tradeTab').className = 'btn alt tab'; };
