import test from 'node:test';
import assert from 'node:assert/strict';

import { DAILY_ROAST_LIMIT, getUtcDay, getResetAt, reserveDailyRoast, releaseDailyRoast } from '../services/dailyRoastLimit.js';

test('getUtcDay and getResetAt use UTC boundaries', () => {
  const now = new Date('2026-08-21T23:59:30.000Z');
  assert.equal(getUtcDay(now), '2026-08-21');
  assert.equal(getResetAt(now).toISOString(), '2026-08-22T00:00:00.000Z');
});

test('reserveDailyRoast ensures the daily counter then atomically reserves a slot', async () => {
  let ensureQuery, ensureUpdate, ensureOptions, query, update, options;
  const model = {
    updateOne: async (nextQuery, nextUpdate, nextOptions) => {
      ensureQuery = nextQuery;
      ensureUpdate = nextUpdate;
      ensureOptions = nextOptions;
    },
    findOneAndUpdate: async (nextQuery, nextUpdate, nextOptions) => {
      query = nextQuery;
      update = nextUpdate;
      options = nextOptions;
      return { count: 37 };
    },
  };
  const result = await reserveDailyRoast({ model, now: new Date('2026-08-21T10:00:00.000Z') });
  assert.deepEqual(ensureQuery, { day: '2026-08-21' });
  assert.equal(ensureUpdate.$setOnInsert.count, 0);
  assert.equal(ensureOptions.upsert, true);
  assert.deepEqual(query, { day: '2026-08-21', count: { $lt: DAILY_ROAST_LIMIT } });
  assert.equal(update.$inc.count, 1);
  assert.equal(options.new, true);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 63);
});

test('reserveDailyRoast continues after a concurrent counter creation race', async () => {
  const duplicate = new Error('duplicate');
  duplicate.code = 11000;
  const model = {
    updateOne: async () => { throw duplicate; },
    findOneAndUpdate: async () => ({ count: 2 }),
  };
  const result = await reserveDailyRoast({ model, now: new Date('2026-08-21T10:00:00.000Z') });
  assert.equal(result.allowed, true);
  assert.equal(result.count, 2);
  assert.equal(result.remaining, 98);
});

test('reserveDailyRoast rejects when the guarded increment finds an exhausted counter', async () => {
  const model = {
    updateOne: async () => {},
    findOneAndUpdate: async () => null,
  };
  const result = await reserveDailyRoast({ model, now: new Date('2026-08-21T10:00:00.000Z') });
  assert.equal(result.allowed, false);
  assert.equal(result.count, 100);
  assert.equal(result.remaining, 0);
});

test('reserveDailyRoast surfaces unexpected database errors', async () => {
  const model = { updateOne: async () => { throw new Error('database unavailable'); } };
  await assert.rejects(() => reserveDailyRoast({ model }), /database unavailable/);
});

test('releaseDailyRoast decrements only an existing positive reservation', async () => {
  let query, update;
  const model = { findOneAndUpdate: async (nextQuery, nextUpdate) => { query = nextQuery; update = nextUpdate; } };
  await releaseDailyRoast('2026-08-21', { model });
  assert.deepEqual(query, { day: '2026-08-21', count: { $gt: 0 } });
  assert.deepEqual(update, { $inc: { count: -1 } });
});
