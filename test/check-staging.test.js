'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkStaging } = require('../check-staging');
const { getOpenApiSpec } = require('../openapi');
const origin = 'https://staging.example.invalid';
const key = 'a'.repeat(64);
const expectedSha = 'b'.repeat(40);
const response = (status, body, build = expectedSha) => ({ status,
  headers: new Headers(build ? { 'X-Nova-Staging-Build': build } : {}), json: async () => body });

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
  const result = await checkStaging({ origin, key, expectedSha, request });
  assert.deepEqual(result, { schema: 'pass', buildIdentity: 'matched', anonymous: 'denied', wrongKey: 'denied',
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
    await assert.rejects(checkStaging({ origin: badOrigin, key, expectedSha, request }));
  }
  for (const badKey of ['', 'x'.repeat(31), ' '.repeat(32), key + '\n']) {
    await assert.rejects(checkStaging({ origin, key: badKey, expectedSha, request }));
  }
  assert.equal(calls.length, 0);
});

test('schema drift or redirect stops before any credentials are sent', async () => {
  const publicOverride = getOpenApiSpec(origin);
  publicOverride.paths['/notion/status'].get.security = [];
  for (const reply of [response(307), response(200, getOpenApiSpec('https://other.example.invalid')),
    response(200, publicOverride), response(200, null)]) {
    const { calls, request } = fixture({ 0: reply });
    await assert.rejects(checkStaging({ origin, key, expectedSha, request }), /Schema/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, undefined);
  }
});

test('anonymous access, wrong-key admission and 503 fail before using the real key', async () => {
  for (const overrides of [{ 1: response(200) }, { 1: response(503) }, { 2: response(200) }, { 2: response(307) }]) {
    const { calls, request } = fixture(overrides);
    await assert.rejects(checkStaging({ origin, key, expectedSha, request }), /admission/);
    assert.ok(calls.every(c => c.options.headers.Authorization !== 'Bearer ' + key));
  }
});

test('transport failure and remote rejection do not leak remote messages or secrets', async () => {
  for (const reply of [new Error('private transport detail ' + key), response(403, { error: key }), response(307)]) {
    const { calls, request } = fixture({ 3: reply });
    await assert.rejects(checkStaging({ origin, key, expectedSha, request }), error => {
      assert.match(error.message, /Staging-key admission/);
      assert.ok(!error.message.includes(key));
      return true;
    });
    assert.equal(calls.length, 4);
  }
});

test('missing Notion bindings are distinguished from successful HTTP authentication', async () => {
  const { request } = fixture({ 3: response(200, { configured: false, databases: { memory: true, journal: false } }) });
  const result = await checkStaging({ origin, key, expectedSha, request });
  assert.equal(result.stagingKey, 'admitted');
  assert.equal(result.notionConfigured, false);
  assert.equal(result.journalDatabaseConfigured, false);
});

test('missing staging opt-in or stale build blocks all bearer requests', async () => {
  for (const build of [null, 'c'.repeat(40)]) {
    const { calls, request } = fixture({ 0: response(200, getOpenApiSpec(origin), build) });
    await assert.rejects(checkStaging({ origin, key, expectedSha, request }), /build identity/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, undefined);
  }
  const { calls, request } = fixture();
  for (const sha of [undefined, '', 'abc', 'Z'.repeat(40)]) {
    await assert.rejects(checkStaging({ origin, key, expectedSha: sha, request }), /EXPECTED_SHA/);
  }
  assert.equal(calls.length, 0);
});


test('auth-only schema exposes exactly the read-only status operation and inherits bearer', async () => {
  const restricted = getOpenApiSpec(origin, true);
  assert.deepEqual(Object.keys(restricted.paths), ['/notion/status']);
  assert.deepEqual(Object.keys(restricted.paths['/notion/status']), ['get']);
  assert.deepEqual(restricted.security, [{ bearerAuth: [] }]);
  assert.equal(restricted.paths['/notion/status'].get.operationId, 'getNotionStatus');
  assert.equal(restricted.paths['/notion/status'].get.security, undefined);
  assert.ok(getOpenApiSpec(origin).paths['/memory'].post);
  const { calls, request } = fixture({ 0: response(200, restricted),
    3: response(200, { configured: false, databases: { memory: false, journal: false } }) });
  const result = await checkStaging({ origin, key, expectedSha, authOnly: true, request });
  assert.equal(result.stagingKey, 'admitted');
  assert.equal(calls.length, 4);
});

test('auth-only gate rejects broad schema before any bearer and fails on any configured integration', async () => {
  const broad = fixture();
  await assert.rejects(checkStaging({ origin, key, expectedSha, authOnly: true, request: broad.request }), /authentication-only staging/);
  assert.equal(broad.calls.length, 1);
  assert.equal(broad.calls[0].options.headers.Authorization, undefined);
  for (const state of [
    { configured: true, databases: { memory: false, journal: false } },
    { configured: false, databases: { memory: true, journal: false } },
    { configured: false, databases: { memory: false, journal: true } }
  ]) {
    const { request } = fixture({ 0: response(200, getOpenApiSpec(origin, true)), 3: response(200, state) });
    await assert.rejects(checkStaging({ origin, key, expectedSha, authOnly: true, request }), /no integration configuration/);
  }
});


test('auth-only gate rejects unexpected Action routing or authentication contract before any bearer', async () => {
  for (const mutate of [
    schema => { schema.paths['/notion/status'].get.servers = [{ url: 'https://other.example.invalid' }]; },
    schema => { schema.security.push({}); },
    schema => {
      schema.components.securitySchemes.other = { type: 'apiKey', name: 'X-Other', in: 'header' };
      schema.security.push({ other: [] });
    },
    schema => { schema.paths['/notion/status'].get.operationId = 'otherOperation'; },
    schema => { schema.paths['/notion/status'].get.callbacks = { unexpected: {} }; }
  ]) {
    const schema = getOpenApiSpec(origin, true);
    mutate(schema);
    const { calls, request } = fixture({ 0: response(200, schema),
      3: response(200, { configured: false, databases: { memory: false, journal: false } }) });
    await assert.rejects(checkStaging({ origin, key, expectedSha, authOnly: true, request }),
      /contract differs from the reviewed local schema/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, undefined);
  }
});

test('auth-only exact contract accepts different JSON object key ordering', async () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder) :
    value && typeof value === 'object' ? Object.fromEntries(
      Object.keys(value).reverse().map(name => [name, reorder(value[name])])) : value;
  const schema = reorder(getOpenApiSpec(origin, true));
  const { calls, request } = fixture({ 0: response(200, schema),
    3: response(200, { configured: false, databases: { memory: false, journal: false } }) });
  const result = await checkStaging({ origin, key, expectedSha, authOnly: true, request });
  assert.equal(result.stagingKey, 'admitted');
  assert.equal(calls.length, 4);
});
