'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkStaging } = require('../check-staging');
const { getOpenApiSpec } = require('../openapi');
const origin = 'https://staging.example.invalid';
const key = 'a'.repeat(64);
const response = (status, body) => ({ status, json: async () => body });

function fixture(overrides = {}) {
  const calls = [];
  const replies = [response(200, getOpenApiSpec(origin)), response(401),
    response(401), response(200, { configured: true, databases: { memory: true, journal: true } })];
  const request = async (url, options) => {
    calls.push({ url, options });
    const i = calls.length - 1;
    if (overrides[i] instanceof Error) throw overrides[i];
    return overrides[i] || replies[i];
  };
  return { calls, request };
}

test('staging gate uses only read-only requests to the explicit origin and reports no secret', async () => {
  const { calls, request } = fixture();
  const result = await checkStaging({ origin, key, request });
  assert.deepEqual(result, { schema: 'pass', anonymous: 'denied', wrongKey: 'denied',
    stagingKey: 'admitted', notionConfigured: true, memoryDatabaseConfigured: true, journalDatabaseConfigured: true });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(c => c.url), [origin + '/openapi.json', ...Array(3).fill(origin + '/notion/status')]);
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'manual' && c.options.signal));
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.notEqual(calls[2].options.headers.Authorization, 'Bearer ' + key);
  assert.equal(calls[3].options.headers.Authorization, 'Bearer ' + key);
  assert.ok(!JSON.stringify(result).includes(key));
});

test('rejects production, unsafe origins and malformed staging secrets before any request', async () => {
  const { calls, request } = fixture();
  for (const badOrigin of ['https://nova-memory-server.onrender.com', 'http://localhost:3000',
    'https://user:pass@staging.example.invalid', origin + '/path', origin + '?x=1', origin + '#fragment']) {
    await assert.rejects(checkStaging({ origin: badOrigin, key, request }));
  }
  for (const badKey of ['', 'x'.repeat(31), ' '.repeat(32), key + '\n']) {
    await assert.rejects(checkStaging({ origin, key: badKey, request }));
  }
  assert.equal(calls.length, 0);
});

test('schema drift or redirect stops before any credentials are sent', async () => {
  const publicOverride = getOpenApiSpec(origin);
  publicOverride.paths['/notion/status'].get.security = [];
  for (const reply of [response(307), response(200, getOpenApiSpec('https://other.example.invalid')),
    response(200, publicOverride), response(200, null)]) {
    const { calls, request } = fixture({ 0: reply });
    await assert.rejects(checkStaging({ origin, key, request }), /Schema/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, undefined);
  }
});

test('anonymous access, wrong-key admission and 503 fail before using the real key', async () => {
  for (const overrides of [{ 1: response(200) }, { 1: response(503) }, { 2: response(200) }, { 2: response(307) }]) {
    const { calls, request } = fixture(overrides);
    await assert.rejects(checkStaging({ origin, key, request }), /admission/);
    assert.ok(calls.every(c => c.options.headers.Authorization !== 'Bearer ' + key));
  }
});

test('transport failure and remote rejection do not leak remote messages or secrets', async () => {
  for (const reply of [new Error('private transport detail ' + key), response(403, { error: key }), response(307)]) {
    const { calls, request } = fixture({ 3: reply });
    await assert.rejects(checkStaging({ origin, key, request }), error => {
      assert.match(error.message, /Staging-key admission/);
      assert.ok(!error.message.includes(key));
      return true;
    });
    assert.equal(calls.length, 4);
  }
});

test('missing Notion bindings are distinguished from successful HTTP authentication', async () => {
  const { request } = fixture({ 3: response(200, { configured: false, databases: { memory: true, journal: false } }) });
  const result = await checkStaging({ origin, key, request });
  assert.equal(result.stagingKey, 'admitted');
  assert.equal(result.notionConfigured, false);
  assert.equal(result.journalDatabaseConfigured, false);
});
