# Trader Sim — BTC Only (2013–2017)

This sim is now **Bitcoin-only**.

## Core settings

- Simulation window: **2013-01-01 → 2017-12-31**
- Tick cadence: **1 tick = 1 day**
- Default speed: **1 day/sec** (`tickMs=1000`)
- Fast speed: **2 days/sec** (`tickMs=500`)
- Optional deterministic runs: `SIM_SEED=<number>`

## Routes

### Player (mobile-first)
- `/player/lobby`
- `/player/trade`
- `/player/mine`

### Admin
- `/admin/leaderboard`
- `/admin/news`
- `/admin/control`

## BTC-only features

- Trading: BTC only, long-only buy/sell.
- Mining: BTC only.
- No ETH/meme assets, no unlock system.

## Data files

- `server/data/btc_usd_daily_2013_2017.csv`
- `server/data/network_hashrate_monthly_2013_2017.csv`
- `server/data/events_2013_2017.json`

## Candle preload behavior

Both charts (player trade + admin news) preload **52 daily candles** on initial socket sync, then receive daily candle updates each tick.

## Run

```bash
npm install
npm run dev
```

Env vars:
- `PORT` (default `10000`)
- `ADMIN_PIN` (default `1234`)
- `DB_PATH` (default `./data/sim.db`)
- `TICK_MS` (default `1000`)
- `SIM_SEED` (optional)
