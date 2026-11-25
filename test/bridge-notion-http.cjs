'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const test = require('node:test');

test('authenticated journal bridge uses its Notion database and replays one delivery',
  { timeout: 30000 }, async t => {
    const temp = await mkdtemp(path.join(tmpdir(), 'nova-notion-http-'));
    const receipt = path.join(temp, 'requests.jsonl');
    const key = randomBytes(32).toString('hex');
    const server = spawn(process.execPath, [
      '--require', require.resolve('./fixtures/offline-notion-adapter.cjs'),
      require.resolve('../index.js')
    ], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        PATH: process.env.PATH,
        PORT: '0',
        NOVA_MEMORY_HOST: '127.0.0.1',
        NOVA_MEMORY_API_KEY: key,
        NOTION_TOKEN: 'offline-notion-token',
        NOTION_MEMORY_DATABASE_ID: 'offline-memory',
        NOTION_JOURNAL_DATABASE_ID: 'offline-journal',
        TEST_NOTION_RECEIPT: receipt
      }
    });
    const exited = once(server, 'exit');
    t.after(async () => {
      try {
        if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
        await exited;
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });

    let base;
    const lines = createInterface({ input: server.stdout });
    for await (const line of lines) {
      const address = /^Nova Memory Server listening on 127\.0\.0\.1 port (\d+)$/.exec(line);
      if (address) {
        base = 'http://127.0.0.1:' + address[1];
        break;
      }
    }
    assert.ok(base, 'server must announce its loopback port');

    const entry = { userId: 'offline-user', entryType: 'journal', title: 'Bridge note', content: 'Offline delivery' };
    const send = headers => fetch(base + '/bridge/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'offline-retry', ...headers },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(5000)
    });
    const denied = await send({});
    assert.equal(denied.status, 401);
    await denied.text();

    const auth = { Authorization: 'Bearer ' + key };
    const first = await send(auth);
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.success, true);
    assert.deepEqual(result.notion, { enabled: true, success: true, pageId: 'offline-page' });
    assert.deepEqual(result.unova, { enabled: false });
    const again = await send(auth);
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), result);

    const journal = await fetch(base + '/journal?userId=offline-user', {
      headers: auth, signal: AbortSignal.timeout(5000)
    });
    assert.equal(journal.status, 200);
    assert.deepEqual(await journal.json(), [result.stored.entry]);
    const records = (await readFile(receipt, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 1, 'exactly one serialized Notion request and no outbound sockets');
    const [call] = records;
    assert.equal(call.method, 'post');
    assert.equal(call.url, 'https://api.notion.com/v1/pages');
    assert.equal(call.hasFixtureCredential, true);
    assert.equal(call.version, '2022-06-28');
    assert.equal(call.body.parent.database_id, 'offline-journal');
    assert.equal(call.body.properties.Name.title[0].text.content, entry.title);
    assert.equal(call.body.children[0].paragraph.rich_text[0].text.content, entry.content);

    // These authenticated requests must never reach the Notion transport.
    // Local storage is intentionally independent of optional delivery.
    for (const [i, notion] of [{ databaseId: 'offline-memory' },
      { databaseId: 'unrelated-db' }, { token: 'caller-token' }].entries()) {
      const deniedDelivery = await fetch(base + '/bridge/entry', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'denied-' + i },
        body: JSON.stringify({ ...entry, userId: 'override-test-user', notion }),
        signal: AbortSignal.timeout(5000)
      });
      assert.equal(deniedDelivery.status, 200);
      const body = await deniedDelivery.json();
      assert.equal(body.success, true);
      assert.equal(body.notion.success, false);
    }
    assert.equal((await readFile(receipt, 'utf8')).trim().split('\n').length, 1,
      'rejected overrides must not produce any additional serialized requests');
  });
