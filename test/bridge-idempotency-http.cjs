'use strict';

// Real loopback HTTP proof for the still-unmerged, stacked bridge branch.
// This test never contacts an external Notion or UNOVA endpoint.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function freePort() {
  const s = http.createServer();
  await new Promise((resolve, reject) => s.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}

async function main() {
  const port = await freePort();
  const receiverPort = await freePort();
  const deliveries = [];
  const receiver = http.createServer(async (req, res) => {
    let buffer = '';
    for await (const chunk of req) buffer += chunk;
    deliveries.push({
      method: req.method, url: req.url, auth: req.headers.authorization,
      body: JSON.parse(buffer)
    });
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve, reject) => receiver.once('error', reject).listen(receiverPort, '127.0.0.1', resolve));

  const webhook = 'http://127.0.0.1:' + receiverPort + '/test-webhook';
  const server = spawn(process.execPath, ['index.js'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: String(port), UNOVA_WEBHOOK_URL: webhook,
      UNOVA_API_KEY: 'ci-test-key', NOTION_TOKEN: '', NOTION_DATABASE_ID: ''
    }
  });
  let log = '';
  server.stdout.on('data', chunk => { log += chunk.toString(); });
  server.stderr.on('data', chunk => { log += chunk.toString(); });

  const base = 'http://127.0.0.1:' + port;
  const body = { userId: 'ci-retry-test', entryType: 'memory', topic: 'one', value: 'saved' };
  const write = (key, payload = body) => fetch(base + '/bridge/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(payload)
  });
  try {
    let ready = false;
    for (let i = 0; i < 70; i++) {
      if (server.exitCode !== null) throw new Error('Service exited: ' + log);
      try {
        const result = await fetch(base + '/');
        if (result.ok) { ready = true; break; }
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'Service not ready: ' + log);
    const a = await write('ci-001');
    assert.equal(a.status, 200);
    const first = await a.json();
    assert.equal(first.unova.success, true);
    const b = await write('ci-001');
    assert.equal(b.status, 200);
    const second = await b.json();
    assert.deepEqual(second, first, 'duplicate key must replay original result');
    assert.equal(deliveries.length, 1, 'retry must not send webhook twice');

    const changed = await write('ci-001', { ...body, value: 'changed' });
    assert.equal(changed.status, 409);
    assert.equal(deliveries.length, 1, 'conflicting retry must not send');

    const cBody = { ...body, topic: 'concurrent' };
    const [c1, c2] = await Promise.all([write('ci-002', cBody), write('ci-002', cBody)]);
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);
    assert.deepEqual(await c1.json(), await c2.json());
    assert.equal(deliveries.length, 2, 'concurrent requests must send once');

    const records = await (await fetch(base + '/memory?userId=ci-retry-test')).json();
    assert.deepEqual(records.map(x => x.topic), ['one', 'concurrent']);
    assert.equal(deliveries[0].method, 'POST');
    assert.equal(deliveries[0].url, '/test-webhook');
    assert.equal(deliveries[0].auth, 'Bearer ci-test-key');
    console.log('PASS: real HTTP sequential/concurrent retries store 2 entries and deliver 2 events, conflicting key 409, no duplicate writes');
  } finally {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await new Promise(resolve => receiver.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
