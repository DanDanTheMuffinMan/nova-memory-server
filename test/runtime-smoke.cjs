'use strict';

// Real loopback HTTP/Socket.IO parity checks against the composed draft code.
// This never contacts Notion, UNOVA webhooks, or a user's Mac.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { once } = require('node:events');
const { io } = require('socket.io-client');

const port = randomInt(34000, 48000);
const base = 'http://127.0.0.1:' + port;
const secret = 'ci-local-only-memory-api-key-0123456789abcdef';
const user = 'ci-runtime-smoke';
const env = { ...process.env, PORT: String(port), NOVA_MEMORY_API_KEY: secret };
delete env.DISPLAY;
delete env.NOTION_TOKEN;
delete env.UNOVA_WEBHOOK_URL;
delete env.UNOVA_API_KEY;
const server = spawn(process.execPath, ['index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (data) => { output = (output + data.toString()).slice(-3000); });
}
const auth = { Authorization: 'Bearer ' + secret };
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
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('Socket.IO timeout')); }, 5500);
    function finish(error, kind) {
      clearTimeout(timer);
      if (error) { socket.disconnect(); reject(error); return; }
      if (!authorized) { socket.disconnect(); resolve(kind); return; }
      socket.once('stream-error', ({ error: reason }) => {
        socket.disconnect();
        resolve(reason);
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
    await waitForReady();
    const spec = await (await request('/openapi.json')).json();
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

    const bridge = await (await request('/bridge/entry', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user, entryType: 'memory', topic: 'bridge', value: 'saved' }),
    })).json();
    assert.equal(bridge.success, true);
    const memories = await (await request('/memory?userId=' + user, { headers: auth })).json();
    assert.deepEqual(memories.map(x => x.topic), ['smoke', 'bridge']);

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
    check(authenticated.includes('not available'), 'Expected authenticated stream-error without a display, received: ' + authenticated);
    console.log('PASS: real HTTP auth, memory/bridge persistence, multipart size rejection, Socket.IO admission and no-display handler');
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
  }
}
main().catch(error => { console.error('FAIL: ' + error.stack + '\nServer tail:\n' + output); process.exitCode = 1; });
