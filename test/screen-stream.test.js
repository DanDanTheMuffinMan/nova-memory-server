'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenStream } = require('../screen-stream');

function harness(capture = async () => Buffer.from('jpg')) {
  const timers = new Map();
  const events = [];
  const cleared = [];
  let serial = 0;
  const stream = createScreenStream({
    capture,
    emit: (name, payload) => events.push({ name, payload }),
    setTimer: (fn, delay) => {
      const id = ++serial;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer: (id) => {
      cleared.push(id);
      timers.delete(id);
    },
    now: () => '2026-11-05T17:02:00.000Z'
  });
  return { stream, events, timers, cleared };
}

test('default rate emits one correctly encoded JPEG frame', async () => {
  const h = harness();
  assert.equal(h.stream.start(), true);
  assert.equal(h.timers.get(1).delay, 1000);
  await h.timers.get(1).fn();
  assert.deepEqual(h.events, [{ name: 'screen-frame', payload: { image: Buffer.from('jpg').toString('base64'), timestamp: '2026-11-05T17:02:00.000Z' } }]);
});

test('invalid and hostile frame rates never install a timer', () => {
  for (const fps of [0, -1, 5.1, Infinity, NaN, '100', null, {}, []]) {
    const h = harness();
    assert.equal(h.stream.start({ fps }), false, String(fps));
    assert.equal(h.timers.size, 0);
    assert.equal(h.events[0].name, 'stream-error');
  }
});

test('accepted rates bound capture interval between 200ms and 5000ms', () => {
  const h = harness();
  h.stream.start({ fps: 5 });
  assert.equal(h.timers.get(1).delay, 200);
  h.stream.start({ fps: 0.2 });
  assert.equal(h.timers.get(2).delay, 5000);
  assert.deepEqual(h.cleared, [1]);
  assert.equal(h.timers.size, 1);
});

test('restarting a stream replaces its timer instead of multiplying intervals', () => {
  const h = harness();
  h.stream.start({ fps: 1 });
  h.stream.start({ fps: 2 });
  h.stream.start({ fps: 3 });
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.cleared, [1, 2]);
});

test('invalid restart stops any previously active stream', () => {
  const h = harness();
  h.stream.start();
  assert.equal(h.stream.start({ fps: 0 }), false);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.cleared, [1]);
});

test('stop prevents a callback retained from an old timer from capturing', async () => {
  let captures = 0;
  const h = harness(async () => { captures++; return Buffer.from('jpg'); });
  h.stream.start();
  const oldCallback = h.timers.get(1).fn;
  h.stream.stop();
  await oldCallback();
  assert.equal(captures, 0);
  assert.equal(h.events.length, 0);
});

test('overlapping capture ticks never queue more than one screenshot', async () => {
  let resolveCapture;
  let count = 0;
  const h = harness(() => {
    count++;
    return new Promise((resolve) => { resolveCapture = resolve; });
  });
  h.stream.start();
  const callback = h.timers.get(1).fn;
  const pending = callback();
  await callback();
  assert.equal(count, 1);
  resolveCapture(Buffer.from('ok'));
  await pending;
  assert.equal(h.events.filter((e) => e.name === 'screen-frame').length, 1);
});

test('late screenshot resolution cannot emit after stop or restart', async () => {
  let resolveCapture;
  const h = harness(() => new Promise((resolve) => { resolveCapture = resolve; }));
  h.stream.start();
  const pending = h.timers.get(1).fn();
  h.stream.start({ fps: 2 });
  resolveCapture(Buffer.from('late'));
  await pending;
  assert.equal(h.events.length, 0);
});

test('capture failures report a stable, non-sensitive error', async () => {
  const h = harness(async () => { throw new Error('secret /private/path'); });
  h.stream.start();
  await h.timers.get(1).fn();
  assert.deepEqual(h.events, [{ name: 'stream-error', payload: { error: 'Screen capture failed' } }]);
});

test('disconnect stop suppresses an in-flight capture failure', async () => {
  let rejectCapture;
  const h = harness(() => new Promise((resolve, reject) => { rejectCapture = reject; }));
  h.stream.start();
  const pending = h.timers.get(1).fn();
  h.stream.stop();
  rejectCapture(new Error('private'));
  await pending;
  assert.equal(h.timers.size, 0);
  assert.equal(h.events.length, 0);
});
