'use strict';

// Exercise keyed writes against an authenticated server and a loopback webhook.
// This test never contacts an external Notion or UNOVA endpoint.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
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
  const apiKey = randomBytes(32).toString('hex');
  const auth = { Authorization: `Bearer ${apiKey}` };
  const receiverPort = await freePort();
  const deliveries = [];
  const receiver = http.createServer(async (req, res) => {
    let buffer = '';
    for await (const chunk of req) buffer += chunk;
    deliveries.push({
      method: req.method, url: req.url, auth: req.headers.authorization,
      body: JSON.parse(buffer)
    });
    const topic = deliveries[deliveries.length - 1].body.payload?.topic;
    if (req.url === '/test-webhook' && topic === 'redirect') {
      res.writeHead(307, { Location: '/unexpected-redirect-target' });
      return res.end();
    }
    if (req.url === '/test-webhook' && topic === 'reflected-error') {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reflectedAuthorization: req.headers.authorization,
        privateResponse: 'private-upstream-fixture' }));
    }
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve, reject) => receiver.once('error', reject).listen(receiverPort, '127.0.0.1', resolve));

  const webhook = 'http://127.0.0.1:' + receiverPort + '/test-webhook';
  const server = spawn(process.execPath, ['index.js'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      NOVA_MEMORY_HOST: '127.0.0.1',
      NOVA_MEMORY_API_KEY: apiKey,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      UNOVA_WEBHOOK_URL: webhook,
      UNOVA_API_KEY: 'ci-test-key',
      NOTION_TOKEN: '',
      NOTION_DATABASE_ID: ''
    }
  });
  let log = '';
  server.stdout.on('data', chunk => { log += chunk.toString(); });
  server.stderr.on('data', chunk => { log += chunk.toString(); });

  const base = 'http://127.0.0.1:' + port;
  const body = { userId: 'ci-retry-test', entryType: 'memory', topic: 'one', value: 'saved' };
  const write = (key, payload = body) => fetch(base + '/bridge/entry', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': key },
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
    const spec = await (await fetch(base + '/openapi.json')).json();
    const bridgeSpec = spec.paths['/bridge/entry'].post;
    assert.equal(bridgeSpec.parameters.find(p => p.name === 'Idempotency-Key')?.in, 'header');
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

    const records = await (await fetch(base + '/memory?userId=ci-retry-test', { headers: auth })).json();
    assert.deepEqual(records.map(x => x.topic), ['one', 'concurrent']);
    assert.equal(deliveries[0].method, 'POST');
    assert.equal(deliveries[0].url, '/test-webhook');
    assert.equal(deliveries[0].auth, 'Bearer ci-test-key');
    const redirectBody = { ...body, topic: 'redirect' };
    const redirect = await write('ci-redirect', redirectBody);
    assert.equal(redirect.status, 200);
    const rejected = await redirect.json();
    assert.equal(rejected.success, true, 'local storage remains independent');
    assert.equal(rejected.unova.success, false, '307 must be treated as delivery failure');
    assert.equal(deliveries.length, 3, 'redirect target must receive no request');
    assert.equal(deliveries[2].url, '/test-webhook');
    const replay = await write('ci-redirect', redirectBody);
    assert.deepEqual(await replay.json(), rejected);
    assert.equal(deliveries.length, 3, 'keyed retry must not resend failed delivery');
    console.log('PASS: real HTTP retries, conflicting key 409, and 307 redirect containment with no redirected delivery');
    const errorBody = { ...body, topic: 'reflected-error' };
    const failed = await write('ci-reflected-error', errorBody);
    assert.equal(failed.status, 200);
    const failedText = await failed.text();
    assert.ok(!failedText.includes('ci-test-key') && !failedText.includes('private-upstream-fixture'));
    const failedResult = JSON.parse(failedText);
    assert.equal(failedResult.success, true);
    assert.deepEqual(failedResult.unova, { enabled: true, success: false, status: 502,
      error: 'Bridge delivery rejected by upstream; remote outcome unknown' });
    assert.equal(deliveries.length, 4);
    const repeatedFailure = await write('ci-reflected-error', errorBody);
    assert.equal(repeatedFailure.status, 200);
    assert.deepEqual(await repeatedFailure.json(), failedResult);
    assert.equal(deliveries.length, 4, 'replayed failure must not resend upstream');
    console.log('PASS: upstream error body and reflected bearer withheld from HTTP response and keyed replay');
  } finally {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await new Promise(resolve => receiver.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
