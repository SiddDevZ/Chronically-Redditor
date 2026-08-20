import test from 'node:test';
import assert from 'node:assert/strict';

import router from '../routes/response.js';
import Roast from '../models/Roast.js';
import DailyRoastUsage from '../models/DailyRoastUsage.js';

async function withModelMethods(methods, run) {
  const originals = [];
  for (const [model, name, value] of methods) {
    originals.push([model, name, model[name]]);
    model[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [model, name, value] of originals) model[name] = value;
  }
}

function request(username, ip) {
  return router.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ username }),
  });
}

test('cached roasts bypass the global daily quota', async () => {
  let quotaTouched = false;
  await withModelMethods([
    [Roast, 'findOne', async () => ({ username: 'cached-user' })],
    [DailyRoastUsage, 'updateOne', async () => { quotaTouched = true; }],
  ], async () => {
    const response = await request('cached-user', '198.51.100.10');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.redirect, true);
    assert.equal(quotaTouched, false);
  });
});

test('exhausted global quota returns 429 with reset metadata', async () => {
  await withModelMethods([
    [Roast, 'findOne', async () => null],
    [DailyRoastUsage, 'updateOne', async () => {}],
    [DailyRoastUsage, 'findOneAndUpdate', async () => null],
  ], async () => {
    const response = await request('new-user', '198.51.100.11');
    const body = await response.json();
    assert.equal(response.status, 429);
    assert.equal(body.limit, 100);
    assert.equal(body.remaining, 0);
    assert.match(body.resetAt, /T00:00:00\.000Z$/);
    assert.ok(Number(response.headers.get('Retry-After')) > 0);
  });
});
