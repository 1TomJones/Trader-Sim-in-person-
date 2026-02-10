import { CLIENT_EVENTS, SERVER_EVENTS } from '/shared/contracts.mjs';
const socket = io();
const path = location.pathname;
const $ = (id) => document.getElementById(id);
let latestMarketState = null;

if ($('go')) $('go').onclick = () => socket.emit(CLIENT_EVENTS.ADMIN_AUTH, { pin: $('pin').value });
socket.on('adminAuthed', () => { if ($('auth')) $('auth').innerHTML = '<span class="good">Admin unlocked</span>'; });
socket.on(SERVER_EVENTS.ERROR, ({ message }) => alert(message));

if ($('start')) $('start').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_START);
if ($('pause')) $('pause').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_PAUSE);
if ($('end')) $('end').onclick = () => socket.emit(CLIENT_EVENTS.REQUEST_END);

socket.on(SERVER_EVENTS.LEADERBOARD, ({ rows }) => {
  if (!$('rows')) return;
  $('rows').innerHTML = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>$${r.netWorth.toFixed(2)}</td><td class='${r.pnl>=0?'good':'bad'}'>$${r.pnl.toFixed(2)}</td><td>$${r.cash.toFixed(2)}</td></tr>`).join('');
});

socket.on(SERVER_EVENTS.NEWS_FEED_UPDATE, ({ events, tickers, energy }) => {
  if ($('news')) $('news').innerHTML = events.map((e) => `<div class='asset'><b>${new Date(e.timestamp).toLocaleTimeString()}</b> ${e.headline}<div class='muted'>${e.body}</div></div>`).join('');
  if ($('cards')) $('cards').innerHTML = ['BTC','ETH','SOL','DOGE'].map((s) => `<div class='asset'><b>${s}</b><div>$${tickers[s]?.price?.toFixed?.(6) || '-'}</div></div>`).join('') + `<div class='asset'><b>EU Energy</b><div>$${Number(energy.EUROPE).toFixed(3)}/kWh</div></div>`;
  if ($('ticker')) $('ticker').innerHTML = Object.entries(tickers).slice(0,7).map(([k,v]) => `${k} $${v.price.toFixed(6)}`).join(' • ') + ` • EU:$${energy.EUROPE.toFixed(3)} • US:$${energy.AMERICA.toFixed(3)}`;
});

socket.on(SERVER_EVENTS.ADMIN_MARKET_STATE, (s) => {
  latestMarketState = s;
  if ($('positions')) $('positions').textContent = JSON.stringify(s.positionsSummary, null, 2);
  if ($('elog')) $('elog').textContent = s.eventLog.map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.message}`).join('\n');
  if ($('assetControls')) {
    $('assetControls').innerHTML = s.perAsset.map((a) => `<div class='row'><span style='width:48px'>${a.symbol}</span><input type='number' step='any' data-tick='${a.symbol}' value='${a.tickSize}'/><select data-dir='${a.symbol}'><option>UP</option><option>DOWN</option></select><input type='number' step='0.01' data-strength='${a.symbol}' value='0.65'/><input type='number' data-adur='${a.symbol}' value='120'/><label><input type='checkbox' data-reset='${a.symbol}'/>Reset</label></div>`).join('');
  }
  if ($('energyControls')) {
    $('energyControls').innerHTML = Object.entries(s.energyPrices).map(([r,v]) => `<div class='row'><span style='width:80px'>${r}</span><input type='number' step='0.001' data-energy='${r}' value='${v}'/></div>`).join('');
  }
  if ($('affected')) $('affected').innerHTML = s.perAsset.map((a) => `<option value='${a.symbol}'>${a.symbol}</option>`).join('');
});

if ($('applyParams')) $('applyParams').onclick = () => {
  if (!latestMarketState) return;
  const assets = latestMarketState.perAsset.map((a) => ({
    symbol: a.symbol,
    tickSize: Number(document.querySelector(`[data-tick='${a.symbol}']`).value),
    manualBias: { direction: document.querySelector(`[data-dir='${a.symbol}']`).value, strength: Number(document.querySelector(`[data-strength='${a.symbol}']`).value), durationSec: Number(document.querySelector(`[data-adur='${a.symbol}']`).value) },
    resetBias: document.querySelector(`[data-reset='${a.symbol}']`).checked,
  }));
  const energy = Object.keys(latestMarketState.energyPrices).map((r) => ({ region: r, energyPriceUSD: Number(document.querySelector(`[data-energy='${r}']`).value) }));
  socket.emit(CLIENT_EVENTS.ADMIN_UPDATE_MARKET, { assets, energy });
};

if ($('createNews')) $('createNews').onclick = () => {
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
