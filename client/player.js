import { CLIENT_EVENTS, SERVER_EVENTS, SIM_STATUS } from '/shared/contracts.mjs';
const socket = io();
let prices = {};
let assets = [];
let rigCatalog = {};
let regions = [];
let me = null;
let hasJoined = false;
let latestLobbyStatus = SIM_STATUS.LOBBY;

const $ = (id) => document.getElementById(id);

function showPlayerJoin() {
  $('joinScreen').classList.remove('hidden');
  $('waitScreen').classList.add('hidden');
  $('app').classList.add('hidden');
}

function showPlayerWait() {
  $('joinScreen').classList.add('hidden');
  $('waitScreen').classList.remove('hidden');
  $('app').classList.add('hidden');
}

function showPlayerApp() {
  $('joinScreen').classList.add('hidden');
  $('waitScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
}

fetch('/api/bootstrap').then((r) => r.json()).then((b) => {
  assets = b.assets;
  rigCatalog = b.rigCatalog;
  regions = b.regions;
  $('symbol').innerHTML = assets.map((a) => `<option value='${a.symbol}'>${a.symbol}</option>`).join('');
  $('rigType').innerHTML = Object.values(rigCatalog).map((r) => `<option value='${r.key}'>${r.name} ($${r.purchasePrice})</option>`).join('');
  $('rigRegion').innerHTML = regions.map((r) => `<option>${r}</option>`).join('');
});

$('join').onclick = () => {
  socket.emit(CLIENT_EVENTS.JOIN_ROOM, {
    name: $('name').value,
    roomCode: $('room').value,
    playerId: localStorage.getItem('playerId'),
  });
};

socket.on('joined', ({ playerId }) => {
  localStorage.setItem('playerId', playerId);
  hasJoined = true;
  if (latestLobbyStatus === SIM_STATUS.RUNNING) showPlayerApp();
  else showPlayerWait();
});

socket.on(SERVER_EVENTS.ERROR, ({ message }) => alert(message));

socket.on(SERVER_EVENTS.LOBBY_STATE, ({ players, status }) => {
  latestLobbyStatus = status;
  $('status').textContent = status;
  $('players').textContent = `Players waiting: ${players.map((p) => p.name).join(', ') || 'None yet'}`;

  if (!hasJoined) {
    showPlayerJoin();
    return;
  }

  if (status === SIM_STATUS.RUNNING) showPlayerApp();
  else showPlayerWait();
});

socket.on(SERVER_EVENTS.MARKET_TICK, (tick) => { prices = tick.prices; renderAssets(); });
socket.on(SERVER_EVENTS.PLAYER_STATE, (p) => { me = p; renderPlayer(); renderAssets(); });

function renderPlayer() {
  if (!me) return;
  $('cash').textContent = `$${me.cash.toFixed(2)}`;
  $('nw').textContent = `$${me.netWorth.toFixed(2)}`;
  $('pnl').textContent = `$${me.pnl.toFixed(2)}`;
  $('negWarn').classList.toggle('hidden', me.cash >= 0);
  $('buy').disabled = me.cash < 0;
  $('buyRig').disabled = me.cash < 0;
}

function renderAssets() {
  $('assetWrap').innerHTML = assets.map((a) => {
    const p = prices[a.symbol]?.price ?? a.basePrice;
    const prev = prices[a.symbol]?.previous ?? p;
    const up = p >= prev;
    const own = me?.holdings?.[a.symbol]?.qty || 0;
    return `<div class='asset'><b>${a.symbol}</b> <span class='muted'>${a.type}</span><div>$${p.toFixed(6)}</div><div class='${up ? 'good' : 'bad'}'>${up ? '▲' : '▼'} ${(p - prev).toFixed(6)}</div><div class='muted'>Owned: ${own.toFixed(5)} ($${(own * p).toFixed(2)})</div></div>`;
  }).join('');
}

$('buy').onclick = () => socket.emit(CLIENT_EVENTS.BUY_CRYPTO, { symbol: $('symbol').value, qty: Number($('qty').value) });
$('sell').onclick = () => socket.emit(CLIENT_EVENTS.SELL_CRYPTO, { symbol: $('symbol').value, qty: Number($('qty').value) });
$('buyRig').onclick = () => socket.emit(CLIENT_EVENTS.BUY_RIG, { region: $('rigRegion').value, rigType: $('rigType').value, count: Number($('rigCount').value) });
$('sellRig').onclick = () => socket.emit(CLIENT_EVENTS.SELL_RIG, { region: $('rigRegion').value, rigType: $('rigType').value, count: 1 });

socket.on(SERVER_EVENTS.ADMIN_MARKET_STATE, (s) => {
  $('regionWrap').innerHTML = Object.entries(s.energyPrices).map(([r, v]) => {
    const rigs = me?.rigs?.filter((x) => x.region === r).length || 0;
    const est = (me?.rigs?.filter((x) => x.region === r).reduce((sum, rig) => sum + ((rig.hashrateTHs * rig.efficiencyWPerTH) / 1000) * 24 * v, 0) || 0).toFixed(2);
    return `<div class='asset'><b>${r}</b><div>Energy: $${Number(v).toFixed(3)}/kWh</div><div class='muted'>Your rigs: ${rigs}</div><div class='muted'>~Daily cost: $${est}</div></div>`;
  }).join('');
});

$('tradeTab').onclick = () => {
  $('tradeView').classList.remove('hidden');
  $('mineView').classList.add('hidden');
  $('tradeTab').className = 'btn tab';
  $('mineTab').className = 'btn alt tab';
};
$('mineTab').onclick = () => {
  $('mineView').classList.remove('hidden');
  $('tradeView').classList.add('hidden');
  $('mineTab').className = 'btn tab';
  $('tradeTab').className = 'btn alt tab';
};
