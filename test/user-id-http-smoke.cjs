'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:net');
const { once } = require('node:events');
const path = require('node:path');

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  const port = await freePort();
  const apiKey = randomBytes(32).toString('hex');
  const auth = { Authorization: `Bearer ${apiKey}` };
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve(__dirname, '../index.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NOVA_MEMORY_HOST: '127.0.0.1',
      NOVA_MEMORY_API_KEY: apiKey,
      DISPLAY: '',
      NOTION_TOKEN: '',
      NOTION_DATABASE_ID: '',
      UNOVA_WEBHOOK_URL: '',
      UNOVA_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { log += chunk.toString(); });
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90 && !ready; attempt++) {
      if (child.exitCode !== null) throw Error('Server exited before readiness: ' + log);
      try {
        const response = await fetch(base + '/', { signal: AbortSignal.timeout(350) });
        ready = response.ok;
      } catch {}
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Server failed to start: ' + log);

    const jsonPost = (endpoint, body) => fetch(base + endpoint, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const memory = { userId: 'alpha,beta', topic: 'only-string', value: 'first' };
    assert.equal((await jsonPost('/memory', memory)).status, 200);
    assert.equal((await jsonPost('/journal', {
      userId: '[object Object]', title: 'only-string', content: 'first'
    })).status, 200);

    // Earlier versions stored or retrieved these as the same property keys
    // as the valid string IDs above. The 400 must occur before any mutation.
    for (const invalid of [['alpha', 'beta'], { id: 'other' }, 17, '  ', null]) {
      for (const [endpoint, body] of [
        ['/memory', { ...memory, userId: invalid }],
        ['/journal', { userId: invalid, title: 'alias', content: 'should not write' }],
        ['/bridge/entry', { userId: invalid, entryType: 'memory', topic: 'alias', value: 'should not write' }],
        ['/notion/memory', { userId: invalid, topic: 'alias', value: 'should not write' }],
        ['/notion/journal', { userId: invalid, title: 'alias', content: 'should not write' }]
      ]) {
        const response = await jsonPost(endpoint, body);
        assert.equal(response.status, 400, `${endpoint} accepted malformed userId ${JSON.stringify(invalid)}`);
      }
    }

    async function getJSON(endpoint) {
      const response = await fetch(base + endpoint, { headers: auth });
      return { status: response.status, data: await response.json() };
    }
    const validMemory = await getJSON('/memory?userId=alpha%2Cbeta');
    assert.equal(validMemory.status, 200);
    assert.equal(validMemory.data.length, 1, 'aliased ID must not create an extra memory');

    const validJournal = await getJSON('/journal?userId=%5Bobject%20Object%5D');
    assert.equal(validJournal.status, 200);
    assert.equal(validJournal.data.length, 1, 'aliased ID must not create an extra journal');

    for (const endpoint of [
      '/memory?userId=alpha&userId=beta',
      '/journal?userId%5Bkey%5D=value',
      '/media?userId=alpha&userId=beta'
    ]) {
      assert.equal((await getJSON(endpoint)).status, 400, endpoint + ' accepted an array/object query ID');
    }

    const form = new FormData();
    form.append('userId', 'alpha');
    form.append('userId', 'beta');
    form.append('image', new Blob(['data'], { type: 'image/png' }), 'demo.png');
    const mediaResponse = await fetch(base + '/upload/image', { method: 'POST', headers: auth, body: form });
    assert.equal(mediaResponse.status, 400, 'multiple userId form fields must not alias a string ID');
    const media = await getJSON('/media?userId=alpha%2Cbeta');
    assert.equal(media.status, 200);
    assert.deepEqual(media.data, [], 'malformed multipart IDs did not mutate media');
    console.log('PASS: real HTTP rejects nonstring user IDs before memory/journal/bridge/media writes or reads');
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
