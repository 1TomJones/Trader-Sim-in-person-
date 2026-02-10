# Trader Sim — BTC Only (2013–2017)

This sim is now **Bitcoin-only**.

## Core settings

- Simulation window: **2013-01-01 → 2017-12-31**
- Tick cadence: **1 tick = 1 day**
- Default speed: **1 day/sec** (`tickMs=1000`)
- Fast speed: **2 days/sec** (`tickMs=500`)
- Optional deterministic runs: `SIM_SEED=<number>`
- Player starting cash: **$10,000**

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

- `server/data/network_hashrate_monthly_2013_2017.csv`
- `server/data/events_2013_2017.json`
- `server/data/fair_value_schedule_2013_2017.json`

## Price Engine: Fair Value Mean-Reverting Probabilities + OHLC

- Engine maintains:
  - `marketPrice` (tradable BTC price)
  - `fairValue` (hidden anchor, admin-visible only)
- **Future day generation** (simulation ticks):
  - Each day uses **12 intraday sub-steps** to form true OHLC candles.
  - Base probability is 50/50 up/down per sub-step.
  - If market deviates from fair value by more than 5%, probabilities shift toward mean reversion:
    - `shift = (absDevPct - 5) * 0.02`
    - bounded to keep probabilities in `[0.05, 0.95]`
- **Daily step sizing**:
  - `dailyStepUSD = max(1, round(price * dailyStepPct * volatilityMultiplier))`
  - `subStepUSD = max(1, round(dailyStepUSD / sqrt(N)))`
- **Historical preload (generated, not CSV)**:
  - On sim start, 52 prior daily candles are generated at runtime.
  - History uses separate probabilities: `P(down)=0.65`, `P(up)=0.35`.
  - Both player and admin charts receive these 52 bars on initial sync.
- Candle timestamps are UNIX seconds at day start (`00:00:00 UTC`).
- Dev assertions validate:
  - candle bounds (`open/close` within `[low, high]`)
  - `high >= low`
  - exact 1-day candle time increments
  - probability bounds and normalization

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
- `DAILY_STEP_PCT` (optional, default `0.012`)
- `VOLATILITY_MULTIPLIER` (optional, default `1`)
