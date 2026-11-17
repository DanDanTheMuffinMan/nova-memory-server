'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridgeIdempotency, BridgeIdempotencyError } = require('../bridge-idempotency');

const input = (key = 'job-123', changes = {}) => ({
  key, userId: 'user-a', entryType: 'memory',
  body: { userId: 'user-a', entryType: 'memory', topic: 'harvest', value: 'saved' },
  ...changes
});

test('same-key network retry returns same write result and invokes operation once', async () => {
  const guard = createBridgeIdempotency();
  let writes = 0;
  const run = () => guard.execute(input(), async () => ({ count: ++writes }));
  const first = await run();
  const repeat = await run();
  assert.deepEqual(first, { count: 1 });
  assert.deepEqual(repeat, first);
  assert.equal(writes, 1);
});

test('simultaneous same-key requests share one pending write and outbound operation', async () => {
  const guard = createBridgeIdempotency();
  let resolve;
  let calls = 0;
  const pending = new Promise(done => { resolve = done; });
  const run = () => guard.execute(input(), async () => {
    calls++;
    await pending;
    return { saved: true };
  });
  const a = run();
  const b = run();
  assert.equal(a, b, 'concurrent callers should share one Promise');
  resolve();
  assert.deepEqual(await Promise.all([a, b]), [{ saved: true }, { saved: true }]);
  assert.equal(calls, 1);
});

test('same idempotency key with a changed request is a 409 and never executes', async () => {
  const guard = createBridgeIdempotency();
  await guard.execute(input(), async () => 'created');
  let calls = 0;
  assert.throws(() => guard.execute(input('job-123', {
    body: { userId: 'user-a', entryType: 'memory', topic: 'harvest', value: 'changed' }
  }), async () => { calls++; return 'bad'; }), error => (
    error instanceof BridgeIdempotencyError && error.statusCode === 409
  ));
  assert.equal(calls, 0);
});

test('JSON object field order is irrelevant to retry fingerprint', async () => {
  const guard = createBridgeIdempotency();
  let calls = 0;
  await guard.execute(input(), () => ++calls);
  const reordered = { value: 'saved', topic: 'harvest', entryType: 'memory', userId: 'user-a' };
  assert.equal(await guard.execute(input('job-123', { body: reordered }), () => ++calls), 1);
  assert.equal(calls, 1);
});

test('idempotency namespaces separate user IDs and entry types', async () => {
  const guard = createBridgeIdempotency();
  let writes = 0;
  const op = () => ++writes;
  assert.equal(await guard.execute(input(), op), 1);
  assert.equal(await guard.execute(input('job-123', { userId: 'user-b', body: { hello: 'other user' } }), op), 2);
  assert.equal(await guard.execute(input('job-123', { entryType: 'journal', body: { hello: 'journal' } }), op), 3);
});

test('failed action is reserved until expiry to avoid repeated unknown side effects', async () => {
  const guard = createBridgeIdempotency({ now: () => 1000, ttlMs: 100 });
  let calls = 0;
  const run = () => guard.execute(input(), () => {
    calls++;
    throw new Error('transport failed after local write');
  });
  await assert.rejects(run(), /transport failed/);
  await assert.rejects(run(), /transport failed/);
  assert.equal(calls, 1);
});

test('expired result permits a new write and capacity stays bounded', async () => {
  let clock = 100;
  const guard = createBridgeIdempotency({ now: () => clock, ttlMs: 50, maxEntries: 1 });
  let writes = 0;
  assert.equal(await guard.execute(input(), () => ++writes), 1);
  assert.throws(() => guard.execute(input('different-key'), () => ++writes),
    error => error.statusCode === 503);
  clock = 160;
  assert.equal(await guard.execute(input('different-key'), () => ++writes), 2);
});

test('missing key preserves existing non-idempotent behavior', async () => {
  const guard = createBridgeIdempotency();
  let writes = 0;
  assert.equal(await guard.execute(input(undefined, { key: undefined }), () => ++writes), 1);
  assert.equal(await guard.execute(input(undefined, { key: undefined }), () => ++writes), 2);
});

test('malformed and overly long keys are rejected without side effects', () => {
  const guard = createBridgeIdempotency();
  let writes = 0;
  for (const key of ['bad key', 'x'.repeat(129), '<script>', '\u00e9']) {
    assert.throws(() => guard.execute(input(key), () => ++writes),
      error => error.statusCode === 400);
  }
  assert.equal(writes, 0);
});
