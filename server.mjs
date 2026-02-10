import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createDb } from './server/db.mjs';
import { SimEngine } from './server/engine.mjs';
import { CLIENT_EVENTS, SERVER_EVENTS, SIM_STATUS, ASSETS, RIG_CATALOG, REGIONS } from './shared/contracts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const db = createDb(process.env.DB_PATH);
const engine = new SimEngine(db);
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const TICK_MS = Number(process.env.TICK_MS || 1000);

app.use(express.json());
app.use('/client', express.static(path.join(__dirname, 'client')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'client/player.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(__dirname, 'client/player.html')));
app.get('/player/trade', (_req, res) => res.sendFile(path.join(__dirname, 'client/player.html')));
app.get('/admin/leaderboard', (_req, res) => res.sendFile(path.join(__dirname, 'client/admin-leaderboard.html')));
app.get('/admin/news', (_req, res) => res.sendFile(path.join(__dirname, 'client/admin-news.html')));
app.get('/admin/control', (_req, res) => res.sendFile(path.join(__dirname, 'client/admin-control.html')));

app.get('/api/bootstrap', (_req, res) => {
  res.json({ assets: ASSETS, rigCatalog: RIG_CATALOG, regions: REGIONS, simState: engine.state });
});

setInterval(() => {
  engine.stepTick();
  io.emit(SERVER_EVENTS.MARKET_TICK, engine.marketView());
  io.emit(SERVER_EVENTS.LEADERBOARD, { rows: engine.leaderboard() });
  io.emit(SERVER_EVENTS.NEWS_FEED_UPDATE, { events: engine.news.slice(0, 30), tickers: engine.marketView().prices, energy: engine.energy, simDate: engine.simDateISO() });
  io.emit(SERVER_EVENTS.ADMIN_MARKET_STATE, engine.adminMarketState());
  for (const p of engine.players.values()) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit(SERVER_EVENTS.PLAYER_STATE, engine.playerView(p));
  }
}, TICK_MS);

function emitLobby() {
  io.emit(SERVER_EVENTS.LOBBY_STATE, engine.lobbyView());
}

function sendErr(socket, message) {
  socket.emit(SERVER_EVENTS.ERROR, { message });
}

io.on('connection', (socket) => {
  socket.emit(SERVER_EVENTS.MARKET_TICK, engine.marketView());
  socket.emit(SERVER_EVENTS.LEADERBOARD, { rows: engine.leaderboard() });
  socket.emit(SERVER_EVENTS.ADMIN_MARKET_STATE, engine.adminMarketState());
  emitLobby();

  socket.on(CLIENT_EVENTS.JOIN_ROOM, ({ name, roomCode, playerId }) => {
    if (roomCode && roomCode !== 'MAIN') return sendErr(socket, 'Invalid room code. Use MAIN');
    let player = null;
    if (playerId) player = engine.reconnect({ socketId: socket.id, playerId });
    if (!player) player = engine.addPlayer({ socketId: socket.id, name });
    socket.emit('joined', { playerId: player.id, name: player.name });
    socket.emit(SERVER_EVENTS.PLAYER_STATE, engine.playerView(player));
    emitLobby();
  });

  socket.on(CLIENT_EVENTS.ADMIN_AUTH, ({ pin }) => {
    if (String(pin) !== ADMIN_PIN) return sendErr(socket, 'Invalid admin pin');
    socket.data.isAdmin = true;
    socket.emit('adminAuthed', { ok: true });
  });

  socket.on(CLIENT_EVENTS.REQUEST_START, () => {
    if (!socket.data.isAdmin) return sendErr(socket, 'Admin only');
    engine.start();
    emitLobby();
  });
  socket.on(CLIENT_EVENTS.REQUEST_PAUSE, () => {
    if (!socket.data.isAdmin) return sendErr(socket, 'Admin only');
    engine.pause();
    emitLobby();
  });
  socket.on(CLIENT_EVENTS.REQUEST_END, () => {
    if (!socket.data.isAdmin) return sendErr(socket, 'Admin only');
    engine.end();
    emitLobby();
  });

  socket.on(CLIENT_EVENTS.BUY_CRYPTO, ({ symbol, qty }) => {
    const p = engine.getPlayerBySocket(socket.id);
    if (!p) return sendErr(socket, 'Join first');
    const out = engine.buyCrypto(p, symbol, qty);
    if (!out.ok) sendErr(socket, out.message);
  });
  socket.on(CLIENT_EVENTS.SELL_CRYPTO, ({ symbol, qty }) => {
    const p = engine.getPlayerBySocket(socket.id);
    if (!p) return sendErr(socket, 'Join first');
    const out = engine.sellCrypto(p, symbol, qty);
    if (!out.ok) sendErr(socket, out.message);
  });
  socket.on(CLIENT_EVENTS.BUY_RIG, ({ region, rigType, count }) => {
    const p = engine.getPlayerBySocket(socket.id);
    if (!p) return sendErr(socket, 'Join first');
    const out = engine.buyRig(p, region, rigType, count);
    if (!out.ok) sendErr(socket, out.message);
  });
  socket.on(CLIENT_EVENTS.SELL_RIG, (payload) => {
    const p = engine.getPlayerBySocket(socket.id);
    if (!p) return sendErr(socket, 'Join first');
    const out = engine.sellRig(p, payload);
    if (!out.ok) sendErr(socket, out.message);
  });

  socket.on(CLIENT_EVENTS.ADMIN_CREATE_NEWS, (payload) => {
    if (!socket.data.isAdmin) return sendErr(socket, 'Admin only');
    engine.createNews(payload);
  });
  socket.on(CLIENT_EVENTS.ADMIN_UPDATE_MARKET, (payload) => {
    if (!socket.data.isAdmin) return sendErr(socket, 'Admin only');
    engine.updateMarketParams(payload);
  });

  socket.on('disconnect', () => engine.removeSocket(socket.id));
});

const PORT = Number(process.env.PORT || 10000);
server.listen(PORT, () => console.log(`Trader sim running on :${PORT}`));
