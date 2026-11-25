'use strict';

// Real loopback HTTP/Socket.IO parity checks against the composed draft code.
// This contacts only a local UNOVA webhook stub; never external Notion/UNOVA or personal Macs.
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { randomBytes, randomInt } = require('node:crypto');
const { once } = require('node:events');
const http = require('node:http');
const { promisify } = require('node:util');
const runClient = promisify(execFile);
const { io } = require('socket.io-client');

const port = randomInt(34000, 48000);
const webhookPort = randomInt(48001, 61000);
const webhookUrl = 'http://127.0.0.1:' + webhookPort + '/ci-unova-webhook';
const webhookKey = randomBytes(32).toString('hex');
const base = 'http://127.0.0.1:' + port;
const secret = randomBytes(32).toString('hex');
const user = 'ci-runtime-smoke';
const env = {
  ...process.env,
  PORT: String(port),
  NOVA_MEMORY_HOST: '127.0.0.1',
  NOVA_MEMORY_API_KEY: secret,
  NOVA_MEMORY_PUBLIC_ORIGIN: 'https://nova-staging.example.invalid'
};
delete env.DISPLAY;
delete env.NOTION_TOKEN;
// Configure only a local loopback UNOVA receiver; never contact real integrations.
env.UNOVA_WEBHOOK_URL = webhookUrl;
env.UNOVA_API_KEY = webhookKey;
env.NO_PROXY = '127.0.0.1,localhost';
env.no_proxy = '127.0.0.1,localhost';
const server = spawn(process.execPath, ['index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (data) => { output = (output + data.toString()).slice(-3000); });
}
const auth = { Authorization: 'Bearer ' + secret };
// Collect real outbound HTTP requests from the composed server without external traffic.
const deliveries = [];
const webhookServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      deliveries.push({
        method: req.method, path: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'], body,
      });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: true }));
    } catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid test payload' }));
    }
  });
});
function check(value, message) { assert.ok(value, message); }
async function request(path, options = {}, expected = 200) {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(8000) });
  assert.equal(response.status, expected, options.method + ' ' + path + ': expected ' + expected + ', got ' + response.status);
  return response;
}
function socketOutcome(authorized) {
  return new Promise((resolve, reject) => {
    const socket = io(base, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 4500,
      auth: authorized ? { token: secret } : {},
    });
    // Include the first capture outcome in the watchdog window; a connected
    // socket without any frame/error must fail, not hang the CI job.
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('Socket.IO capture timeout')); }, 10000);
    function finish(error, kind) {
      if (error) { clearTimeout(timer); socket.disconnect(); reject(error); return; }
      if (!authorized) { clearTimeout(timer); socket.disconnect(); resolve(kind); return; }
      socket.once('stream-error', ({ error: reason }) => {
        clearTimeout(timer);
        socket.disconnect();
        resolve('error:' + reason);
      });
      socket.once('screen-frame', ({ image }) => {
        clearTimeout(timer);
        socket.disconnect();
        if (typeof image !== 'string' || image.length === 0) {
          reject(new Error('Invalid screenshot frame'));
        } else {
          resolve('screen-frame');
        }
      });
      socket.emit('start-screen-stream', { fps: 1 });
    }
    socket.once('connect_error', error => finish(null, 'rejected:' + error.message));
    socket.once('connect', () => finish(null, 'connected'));
  });
}
async function waitForReady() {
  const expires = Date.now() + 12000;
  while (Date.now() < expires) {
    if (server.exitCode !== null) throw new Error('Server exited before listening: ' + output);
    try { await request('/'); return; } catch (_) { await new Promise(resolve => setTimeout(resolve, 120)); }
  }
  throw new Error('Server not ready: ' + output);
}
async function main() {
  try {
    await new Promise((resolve, reject) => {
      webhookServer.once('error', reject);
      webhookServer.listen(webhookPort, '127.0.0.1', resolve);
    });
    await waitForReady();
    const spec = await (await request('/openapi.json')).json();
    assert.deepEqual(spec.servers, [{ url: env.NOVA_MEMORY_PUBLIC_ORIGIN }]);
    const cli = await runClient(process.execPath, ['test-client.js'], { env, timeout: 15000 });
    assert.match(cli.stdout, /Authenticated REST and Socket.IO admission passed/);
    await assert.rejects(
      runClient(process.execPath, ['test-client.js'], {
        env: { ...env, NOVA_MEMORY_API_KEY: randomBytes(32).toString('hex') },
        timeout: 15000
      }),
      error => error.code === 1 && /401/.test(error.stderr)
    );
    console.log('PASS: bundled client authenticated over REST and Socket.IO and rejected the wrong bearer');
    check(spec.security?.[0]?.bearerAuth, 'OpenAPI bearer auth missing');
    await request('/memory?userId=' + user, {}, 401);
    await request('/memory?userId=' + user, { headers: { Authorization: 'Bearer wrong' } }, 401);
    await request('/control/keyboard/type', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: 'no' }) }, 401);
    const empty = await (await request('/memory?userId=' + user, { headers: auth })).json();
    assert.deepEqual(empty, []);

    const saved = await (await request('/memory', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user, topic: 'smoke', value: 'ok' }),
    })).json();
    assert.equal(saved.success, true);

    // Unauthorized callers must never trigger configured outbound delivery.
    await request('/bridge/entry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user, entryType: 'memory', topic: 'denied', value: 'no' }),
    }, 401);
    assert.equal(deliveries.length, 0, 'unauthorized bridge request emitted a webhook');

    const bridge = await (await request('/bridge/entry', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user, entryType: 'memory', topic: 'bridge', value: 'saved' }),
    })).json();
    assert.equal(bridge.success, true);
    assert.deepEqual(bridge.unova, { enabled: true, success: true, status: 202 });
    assert.equal(deliveries.length, 1, 'expected exactly one loopback webhook');
    assert.equal(deliveries[0].method, 'POST');
    assert.equal(deliveries[0].path, '/ci-unova-webhook');
    assert.equal(deliveries[0].authorization, 'Bearer ' + webhookKey);
    assert.match(deliveries[0].contentType, /^application\/json/);
    assert.equal(deliveries[0].body.event, 'nova.entry.created');
    assert.equal(deliveries[0].body.payload.userId, user);
    assert.equal(deliveries[0].body.payload.topic, 'bridge');
    assert.equal(deliveries[0].body.payload.value, 'saved');

    // A different path on the SAME local receiver safely detects any attempt
    // to send a configured server key to a caller-selected destination.
    // No attacker-controlled external host is ever contacted by the test.
    const malicious = [
      { webhookUrl: webhookUrl + '/untrusted-path' },
      { apiKey: 'ci-request-controlled-key' },
    ];
    for (const override of malicious) {
      const attempt = await (await request('/bridge/entry', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user, entryType: 'memory',
          topic: 'rejected-override', value: 'stored-only', unova: override,
        }),
      })).json();
      assert.equal(attempt.success, true);
      assert.equal(attempt.unova?.success, false, 'webhook override was accepted');
      assert.match(attempt.unova.error, /must be configured on the server/);
      assert.equal(deliveries.length, 1, 'override caused unauthorized outbound HTTP');
    }
    const memories = await (await request('/memory?userId=' + user, { headers: auth })).json();
    assert.deepEqual(memories.map(x => x.topic), ['smoke', 'bridge', 'rejected-override', 'rejected-override']);

    // PR #20 must survive the seven-branch composition, including PR #13 auth.
    // Actual local HTTP calls and a local webhook receiver verify one stored
    // record and outbound event per unique key. No production server contacted.
    const retrySpec = spec.paths['/bridge/entry']?.post?.parameters || [];
    assert.equal(retrySpec.find(param => param.name === 'Idempotency-Key')?.in, 'header',
      'Composed OpenAPI schema lost retry header');
    const payload = { userId: user, entryType: 'memory', topic: 'retry-one', value: 'once' };
    const keyedWrite = (key, body) => request('/bridge/entry', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body)
    });
    const firstReply = await (await keyedWrite('ci-retry-001', payload)).json();
    const repeatReply = await (await keyedWrite('ci-retry-001', payload)).json();
    assert.deepEqual(repeatReply, firstReply, 'sequential retry did not replay original response');
    assert.equal(deliveries.length, 2, 'sequential retry duplicated webhook delivery');

    const changedReply = await fetch(base + '/bridge/entry', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'ci-retry-001' },
      body: JSON.stringify({ ...payload, value: 'conflicting' }),
      signal: AbortSignal.timeout(8000)
    });
    assert.equal(changedReply.status, 409, 'changed-body key reuse should be HTTP 409');
    assert.equal(deliveries.length, 2, 'conflicting retry dispatched a webhook');

    const concurrent = { ...payload, topic: 'retry-concurrent' };
    const [concurrentA, concurrentB] = await Promise.all([
      keyedWrite('ci-retry-002', concurrent),
      keyedWrite('ci-retry-002', concurrent),
    ]);
    assert.deepEqual(await concurrentA.json(), await concurrentB.json(),
      'concurrent matching requests must return the same response');
    assert.equal(deliveries.length, 3, 'concurrent retries duplicated webhook');
    const afterRetry = await (await request('/memory?userId=' + user, { headers: auth })).json();
    assert.deepEqual(afterRetry.map(entry => entry.topic), [
      'smoke', 'bridge', 'rejected-override', 'rejected-override', 'retry-one', 'retry-concurrent'
    ], 'same-key requests added extra memory records');
    console.log('PASS: authenticated sequential/concurrent Idempotency-Key retries yielded one write and webhook per unique request; changed body 409');

    // PR #21 guards every caller-controlled identity before property-key
    // coercion or side effects, even with PR #20's retry wrapper composed.
    const identityAnchor = 'alpha,beta';
    const initialIdentity = await (await request('/memory', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: identityAnchor, topic: 'identity-anchor', value: 'preserved' }),
    })).json();
    assert.equal(initialIdentity.success, true);
    const deliveriesBeforeInvalidIds = deliveries.length;
    for (const invalidId of [['alpha', 'beta'], { anything: 'else' }, 19, '  ', null]) {
      for (const [route, body] of [
        ['/memory', { userId: invalidId, topic: 'alias', value: 'bad' }],
        ['/journal', { userId: invalidId, title: 'alias', content: 'bad' }],
        ['/bridge/entry', { userId: invalidId, entryType: 'memory', topic: 'alias', value: 'bad' }],
        ['/notion/memory', { userId: invalidId, topic: 'alias', value: 'bad' }],
        ['/notion/journal', { userId: invalidId, title: 'alias', content: 'bad' }],
      ]) {
        await request(route, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, 400);
      }
    }
    for (const route of ['/memory', '/journal', '/media']) {
      await request(route + '?userId=alpha&userId=beta', { headers: auth }, 400);
    }
    const ambiguousUpload = new FormData();
    ambiguousUpload.append('userId', 'alpha');
    ambiguousUpload.append('userId', 'beta');
    ambiguousUpload.append('image', new Blob([Buffer.from('unsafe')], { type: 'image/png' }), 'unsafe.png');
    await request('/upload/image', { method: 'POST', headers: auth, body: ambiguousUpload }, 400);
    const afterInvalidIds = await (await request('/memory?userId=alpha%2Cbeta', { headers: auth })).json();
    assert.deepEqual(afterInvalidIds.map(entry => entry.topic), ['identity-anchor'], 'invalid IDs mutated a legitimate user identity');
    assert.equal(deliveries.length, deliveriesBeforeInvalidIds, 'invalid user ID dispatched a webhook');
    console.log('PASS: composed HTTP, query, and multipart user-ID validation rejected aliases without writes or sends');

    // Confirm PR #19's fix against real HTTP routes in the composed checkout.
    for (const specialId of ['__proto__', 'constructor', 'toString']) {
      const encodedId = encodeURIComponent(specialId);
      for (const item of [
        { route: '/memory', payload: { userId: specialId, topic: 'proto-memory-' + specialId, value: 'ok' }, property: 'topic' },
        { route: '/journal', payload: { userId: specialId, title: 'proto-journal-' + specialId, content: 'ok' }, property: 'title' },
      ]) {
        const emptySpecial = await (await request(item.route + '?userId=' + encodedId, { headers: auth })).json();
        assert.deepEqual(emptySpecial, [], 'special ID must have empty own store: ' + item.route + '/' + specialId);
        const savedSpecial = await (await request(item.route, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        })).json();
        assert.equal(savedSpecial.success, true);
        const found = await (await request(item.route + '?userId=' + encodedId, { headers: auth })).json();
        assert.equal(found.length, 1, 'special ID should be isolated: ' + specialId);
        assert.equal(found[0][item.property], item.payload[item.property]);
      }
    }
    const specialBridge = await (await request('/bridge/entry', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'hasOwnProperty', entryType: 'memory', topic: 'proto-bridge', value: 'ok' }),
    })).json();
    assert.equal(specialBridge.success, true);
    const bridgeEntries = await (await request('/memory?userId=hasOwnProperty', { headers: auth })).json();
    assert.deepEqual(bridgeEntries.map(entry => entry.topic), ['proto-bridge']);


    const small = new FormData();
    small.append('userId', user);
    small.append('image', new Blob([Buffer.from('mock-image')], { type: 'image/png' }), 'tiny.png');
    const uploaded = await (await request('/upload/image', { method: 'POST', headers: auth, body: small })).json();
    assert.equal(uploaded.mediaId, 0);

    const tooLarge = new FormData();
    tooLarge.append('userId', user);
    tooLarge.append('image', new Blob([Buffer.alloc(8 * 1024 * 1024 + 1)], { type: 'image/png' }), 'too-large.png');
    await request('/upload/image', { method: 'POST', headers: auth, body: tooLarge }, 413);
    const media = await (await request('/media?userId=' + user, { headers: auth })).json();
    assert.equal(media.length, 1, 'oversize upload must not persist');

    const rejected = await socketOutcome(false);
    check(rejected.startsWith('rejected:Unauthorized'), 'Socket.IO unauthenticated connection accepted: ' + rejected);
    const authenticated = await socketOutcome(true);
    // macOS hosted runners may have a GUI session, may lack screen-recording
    // permission, or may lack optional native capture dependencies. All three
    // must preserve authenticated socket admission and a bounded outcome.
    const expected = process.platform === 'darwin'
      ? ['screen-frame', 'error:Screen capture failed', 'error:Screen capture not available (no display)']
      : ['error:Screen capture not available (no display)'];
    check(expected.includes(authenticated), 'Unexpected authenticated stream outcome: ' + authenticated);
    console.log('PASS: ' + process.platform + ' real HTTP auth, prototype-safe persistence, configured loopback UNOVA webhook 202/bearer, no override leakage, multipart 413, Socket.IO admission; stream outcome=' + authenticated);
  } finally {
    if (webhookServer.listening) {
      await new Promise(resolve => webhookServer.close(resolve));
    }
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
  }
}
main().catch(error => { console.error('FAIL: ' + error.stack + '\nServer tail:\n' + output); process.exitCode = 1; });
