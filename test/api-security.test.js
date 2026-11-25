'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiSecurity } = require('../api-security');

const SECRET = 'a-secure-unique-memory-api-token-of-40-chars';

function invokeHttp(guard, { method = 'GET', path = '/memory', authorization } = {}) {
  let nextCalled = false;
  const result = { status: 200, headers: {}, body: null };
  const req = {
    method, path,
    get(name) { return name.toLowerCase() === 'authorization' ? authorization : undefined; }
  };
  const res = {
    status(code) { result.status = code; return this; },
    set(name, value) { result.headers[name] = value; return this; },
    json(body) { result.body = body; return this; }
  };
  guard.http(req, res, () => { nextCalled = true; });
  return { ...result, nextCalled };
}

function invokeSocket(guard, handshake = {}) {
  let called = false;
  let error = null;
  guard.socket({ handshake }, (err) => { called = true; error = err || null; });
  return { called, error };
}

test('missing secret blocks memory, journal, keyboard, screen and uploads', () => {
  const guard = createApiSecurity(null);
  assert.equal(guard.configured, false);
  for (const path of ['/memory', '/journal', '/control/keyboard/type', '/capture/screen', '/upload/image']) {
    const result = invokeHttp(guard, { path });
    assert.equal(result.status, 503, path);
    assert.equal(result.nextCalled, false, path);
  }
});

test('only GET landing and OpenAPI metadata remain public', () => {
  const guard = createApiSecurity(null);
  for (const path of ['/', '/openapi.json']) {
    assert.equal(invokeHttp(guard, { path }).nextCalled, true);
    assert.equal(invokeHttp(guard, { path, method: 'POST' }).nextCalled, false);
  }
});

test('short secret is not accepted as configured authentication', () => {
  assert.equal(createApiSecurity('short-token').configured, false);
});

test('valid bearer token permits protected REST action', () => {
  const result = invokeHttp(createApiSecurity(SECRET), {
    path: '/control/keyboard/type',
    method: 'POST',
    authorization: 'Bearer ' + SECRET
  });
  assert.equal(result.nextCalled, true);
});

test('REST and Socket.IO headers accept scheme casing and spaces while preserving key case', () => {
  const guard = createApiSecurity(SECRET);
  for (const header of ['bearer ' + SECRET, 'BEaReR   ' + SECRET]) {
    assert.equal(invokeHttp(guard, { authorization: header }).nextCalled, true);
    assert.equal(invokeSocket(guard, { headers: { authorization: header } }).error, null);
  }
  for (const header of ['bearer ' + SECRET.toUpperCase(), 'Bearer\t' + SECRET]) {
    assert.equal(invokeHttp(guard, { authorization: header }).status, 401);
    assert.match(invokeSocket(guard, { headers: { authorization: header } }).error.message, /Unauthorized/);
  }
});

test('incorrect, missing, and malformed bearer tokens are rejected', () => {
  const guard = createApiSecurity(SECRET);
  for (const authorization of [undefined, '', 'Bearer wrong', SECRET, 'Basic ' + SECRET, 'Bearer ' + SECRET + ' extra']) {
    const result = invokeHttp(guard, { authorization });
    assert.equal(result.status, 401);
    assert.equal(result.nextCalled, false);
    assert.match(result.headers['WWW-Authenticate'], /Bearer/);
  }
});

test('Socket.IO refuses connection when API key is missing', () => {
  const result = invokeSocket(createApiSecurity(null), { auth: { token: SECRET } });
  assert.equal(result.called, true);
  assert.match(result.error.message, /not configured/);
});

test('Socket.IO accepts explicit auth token and bearer header', () => {
  const guard = createApiSecurity(SECRET);
  assert.equal(invokeSocket(guard, { auth: { token: SECRET } }).error, null);
  assert.equal(invokeSocket(guard, { headers: { authorization: 'Bearer ' + SECRET } }).error, null);
});

test('Socket.IO rejects invalid and URL-query tokens', () => {
  const guard = createApiSecurity(SECRET);
  for (const handshake of [{ auth: { token: 'wrong' } }, { query: { token: SECRET } }, {}]) {
    const result = invokeSocket(guard, handshake);
    assert.equal(result.called, true);
    assert.match(result.error.message, /Unauthorized/);
  }
});


test('authentication-only staging admits only the public metadata and authenticated status GET', () => {
  const guard = createApiSecurity(SECRET, true);
  for (const path of ['/', '/openapi.json']) assert.equal(invokeHttp(guard, { path }).nextCalled, true);
  for (const authorization of [undefined, 'Bearer wrong']) assert.equal(invokeHttp(guard, { path: '/notion/status', authorization }).status, 401);
  const authorization = 'Bearer ' + SECRET;
  assert.equal(invokeHttp(guard, { path: '/notion/status', authorization }).nextCalled, true);
  for (const [method, path] of [['GET','/memory'], ['GET','/journal'], ['GET','/capture/screen'], ['POST','/memory'], ['POST','/journal'], ['POST','/notion/memory'], ['POST','/bridge/unova'], ['POST','/control/keyboard/type'], ['POST','/upload/image'], ['POST','/notion/status'], ['HEAD','/notion/status'], ['GET','/notion/status/']]) {
    const result = invokeHttp(guard, { method, path, authorization });
    assert.equal(result.status, 403, method + ' ' + path);
    assert.equal(result.nextCalled, false);
  }
  assert.match(invokeSocket(guard, { auth: { token: SECRET } }).error.message, /Authentication-only staging/);
  assert.match(invokeSocket(guard, { auth: { token: 'wrong' } }).error.message, /Unauthorized/);
});

test('the actual Render launcher forces the authentication-only middleware mode', () => {
  const { stagingEnvironment } = require('../start-render-staging');
  const origin = 'https://nova-disposable-test.onrender.com';
  const id = 'srv-disposable123';
  const sha = 'a'.repeat(40);
  const env = stagingEnvironment({ NOVA_STAGING_ONLY: '1', NOVA_STAGING_RENDER_SERVICE_ID: id, RENDER_SERVICE_ID: id,
    NOVA_STAGING_ORIGIN: origin, RENDER_EXTERNAL_URL: origin, NOVA_STAGING_EXPECTED_SHA: sha,
    RENDER_GIT_COMMIT: sha, NOVA_STAGING_API_KEY: 'b'.repeat(64), PORT: '10000', NOVA_STAGING_AUTH_ONLY: '0' });
  assert.equal(env.NOVA_STAGING_AUTH_ONLY, '1');
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['-e', "const assert = require('node:assert/strict'); const guard = require('./api-security').createApiSecurity(); let next = false; let status; guard.http({method:'POST',path:'/memory',get:()=> 'Bearer ' + process.env.NOVA_MEMORY_API_KEY},{status(n){status=n;return this},json(){}},()=>{next=true}); assert.equal(status,403); assert.equal(next,false);"], { cwd: require('node:path').join(__dirname, '..'), env, stdio: 'pipe' });
});
