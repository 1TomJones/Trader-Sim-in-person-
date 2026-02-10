# Trader Sim (In-Person Edition)

A rebuilt multiplayer trading + mining simulation with separated player and admin surfaces.

## What was kept vs replaced

### Kept
- Express + Socket.IO hosting/deploy approach.
- Real-time multiplayer join/lobby flow.
- Render-friendly single Node service setup.
- Existing styling/assets folder support.

### Replaced
- Previous order-book based trading engine.
- Old asset model/order types/news handling.
- Old admin and player UIs.
- Old bot modules and strategy dependencies from active runtime path.

## Code map

- `server.mjs` – app bootstrap, routes, socket wiring, tick broadcast loop.
- `server/db.mjs` – SQLite schema + database initialization.
- `server/engine.mjs` – simulation domain logic (market ticks, trading, mining, news, leaderboard).
- `shared/contracts.mjs` – shared event/domain contracts.
- `client/player.html` + `client/player.js` – mobile-first player app (lobby, trading, mining).
- `client/admin-leaderboard.html` – fullscreen leaderboard display.
- `client/admin-news.html` – Bloomberg-style live admin news feed + ticker.
- `client/admin-control.html` – simulation controls, market params, energy controls, news creation.
- `client/admin.js` – shared admin socket/UI logic.

## Product behavior implemented

- Lobby + admin-controlled sim lifecycle: `LOBBY/RUNNING/PAUSED/ENDED`.
- Long-only trading for major + meme assets.
- Tick-driven random walk pricing with optional admin/news directional biases.
- Mining rigs by region with dynamic energy costs and BTC production.
- Cash can go negative only from running costs; buying is blocked if it would push below zero.
- Selling crypto/rigs always allowed.
- Leaderboard sorted by PnL.
- Strict server-side validation + per-player action rate limits.
- Player reconnection via stored `playerId`.

## Local run

```bash
npm install
npm run dev
```

Player: `http://localhost:10000/player`

Admin:
- `http://localhost:10000/admin/leaderboard`
- `http://localhost:10000/admin/news`
- `http://localhost:10000/admin/control`

## Environment variables

- `PORT` (default `10000`)
- `ADMIN_PIN` (default `1234`)
- `DB_PATH` (default `./data/sim.db`)
- `TICK_MS` (default `1000`)

## Render deployment

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Add env var `ADMIN_PIN` in Render dashboard.
- Optional: set `DB_PATH=/var/data/sim.db` with persistent disk.

## Projector operation recommendations

- Use `1920x1080` for admin screens.
- Display routes on different tabs/displays:
  - Leaderboard fullscreen on projector 1.
  - News feed fullscreen on projector 2.
  - Control panel on operator laptop.

## Realism Mode: 2015–2020

This mode runs the simulation on historical-era pacing and anchors:

- **Sim date starts at `2015-01-01`** and advances **1 day per tick**.
- Tick speed defaults to **`1000ms/day`** and can be changed live by admin to **`500ms/day`**.
- **Deterministic sessions** are supported with `SIM_SEED=<number>` (seeded RNG).
- Data files under `server/data/`:
  - `btc_usd_daily_2015_2020.csv`
  - `btc_network_hashrate_monthly_2015_2020.csv`
  - `events_2015_2020.json`

### Market behavior

- BTC uses a **historical-anchored random walk** with:
  - random ± step moves,
  - event-driven directional bias,
  - magnetic drift toward daily historical target,
  - yearly regime differences for volatility and drift.
- Assets unlock over time via scheduled events.
- Players start with only BTC tradeable; admin/projector receives event headlines.

### Mining realism

- Uses **144 blocks/day**.
- BTC reward schedule:
  - 25 BTC until 2016-07-09
  - 12.5 BTC until 2020-05-11
  - 6.25 BTC after
- Mined BTC/day depends on player hashrate share vs modeled network hashrate.
- Energy cost is charged daily by rig efficiency and region `USD/kWh`.
- Buying crypto/rigs is blocked when cash is non-positive or purchase would push below zero.
