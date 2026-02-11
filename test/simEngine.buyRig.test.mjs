import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { createDb } from '../server/db.mjs';
import { SimEngine } from '../server/engine.mjs';

function createEngineWithPlayer() {
  const dbPath = path.join(os.tmpdir(), `sim-test-${Date.now()}-${Math.random()}.db`);
  const db = createDb(dbPath);
  const engine = new SimEngine(db);
  const player = engine.addPlayer({ socketId: 'socket-1', name: 'Tester' });
  return { engine, player, dbPath };
}

describe('SimEngine buyRig limits', () => {
  it('rejects excessively large miner purchases', () => {
    const { engine, player, dbPath } = createEngineWithPlayer();
    player.cashUSD = 10_000_000;

    const result = engine.buyRig(player, 'EUROPE', 'AVALON_GEN1_2013', 501);

    assert.equal(result.ok, false);
    assert.match(result.message, /Max 500 miners/);
    fs.rmSync(dbPath, { force: true });
  });

  it('still allows valid bulk purchases up to the cap', () => {
    const { engine, player, dbPath } = createEngineWithPlayer();
    player.cashUSD = 10_000_000;

    const result = engine.buyRig(player, 'EUROPE', 'AVALON_GEN1_2013', 500);

    assert.equal(result.ok, true);
    assert.equal(player.rigs.length, 500);
    fs.rmSync(dbPath, { force: true });
  });
});
