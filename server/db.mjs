import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export function createDb(dbPath = path.join(process.cwd(), 'data', 'sim.db')) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, roomId TEXT NOT NULL, createdAt INTEGER NOT NULL, startingCash REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS wallets (playerId TEXT PRIMARY KEY, cashUSD REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS holdings (playerId TEXT NOT NULL, symbol TEXT NOT NULL, qty REAL NOT NULL, avgEntry REAL NOT NULL, PRIMARY KEY(playerId, symbol));
    CREATE TABLE IF NOT EXISTS mining_rigs (id TEXT PRIMARY KEY, playerId TEXT NOT NULL, region TEXT NOT NULL, rigType TEXT NOT NULL, purchasePrice REAL NOT NULL, hashrateTHs REAL NOT NULL, efficiencyWPerTH REAL NOT NULL, resaleValuePct REAL NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS news_events (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, headline TEXT NOT NULL, body TEXT NOT NULL, tags TEXT, affectedAssets TEXT, biasConfig TEXT, energyConfig TEXT, durationSec INTEGER NOT NULL, severity TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS market_state (symbol TEXT PRIMARY KEY, lastPrice REAL NOT NULL, biasDirection TEXT, biasStrength REAL, biasUntil INTEGER, updatedAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, playerId TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, fillPrice REAL NOT NULL, feeUSD REAL NOT NULL, timestamp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cost_ledger (id TEXT PRIMARY KEY, playerId TEXT NOT NULL, type TEXT NOT NULL, amountUSD REAL NOT NULL, timestamp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sim_state (roomId TEXT PRIMARY KEY, status TEXT NOT NULL, startedAt INTEGER, tick INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, roomId TEXT NOT NULL, tick INTEGER NOT NULL, createdAt INTEGER NOT NULL, leaderboard TEXT NOT NULL);
  `);
  return db;
}
