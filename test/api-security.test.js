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
  const guard = createApiSecurity(undefined);
  assert.equal(guard.configured, false);
  for (const path of ['/memory', '/journal', '/control/keyboard/type', '/capture/screen', '/upload/image']) {
    const result = invokeHttp(guard, { path });
    assert.equal(result.status, 503, path);
    assert.equal(result.nextCalled, false, path);
  }
});

test('only GET landing and OpenAPI metadata remain public', () => {
  const guard = createApiSecurity(undefined);
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
  const result = invokeSocket(createApiSecurity(undefined), { auth: { token: SECRET } });
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
