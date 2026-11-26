'use strict';

// Read-only gate for an explicitly designated NONPRODUCTION HTTPS origin.
// Never send credentials until public schema, destination and negative admission pass.
const { randomBytes } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { getOpenApiSpec } = require('./openapi');

function stagingOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Set NOVA_STAGING_ORIGIN to an explicit HTTPS origin'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash ||
      parsed.hostname === 'nova-memory-server.onrender.com') {
    throw new Error('A separate nonproduction HTTPS origin without credentials, path, query or fragment is required');
  }
  return parsed.origin;
}

async function checkStaging({ origin, key, expectedSha, authOnly = false, request = fetch } = {}) {
  const base = stagingOrigin(origin);
  if (typeof expectedSha !== 'string' || !/^[a-f0-9]{40}$/.test(expectedSha)) {
    throw new Error('Set NOVA_STAGING_EXPECTED_SHA to the full reviewed commit SHA');
  }
  if (typeof key !== 'string' || key.length < 32 || !/^[A-Za-z0-9._~+/-]+=*$/.test(key)) {
    throw new Error('Configure a valid staging-only bearer key of at least 32 ASCII characters');
  }
  async function get(path, stage, token) {
    try {
      return await request(base + path, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      // Do not expose remote bodies, URLs, headers, or transport error details.
      throw new Error(stage + ': transport failed');
    }
  }
  async function json(response, stage) {
    try { return await response.json(); } catch { throw new Error(stage + ': invalid JSON'); }
  }
  const schemaResponse = await get('/openapi.json', 'Schema');
  if (schemaResponse.status !== 200) throw new Error('Schema: expected HTTP 200, got ' + schemaResponse.status);
  if (schemaResponse.headers?.get('X-Nova-Staging-Build') !== expectedSha) {
    throw new Error('Schema: missing staging opt-in or unexpected build identity');
  }
  const schema = await json(schemaResponse, 'Schema');
  const scheme = schema?.components?.securitySchemes?.bearerAuth;
  if (schema?.info?.title !== 'Nova Memory Server' || schema?.servers?.length !== 1 ||
      schema.servers[0]?.url !== base || scheme?.type !== 'http' || scheme?.scheme !== 'bearer' ||
      !schema.security?.some(item => Object.hasOwn(item, 'bearerAuth')) ||
      !schema.paths?.['/notion/status']?.get ||
      schema.paths['/notion/status'].get.security !== undefined) {
    throw new Error('Schema: expected matching Nova HTTPS origin and inherited bearer authentication');
  }
  if (authOnly && (Object.keys(schema.paths).length !== 1 ||
      Object.keys(schema.paths['/notion/status']).length !== 1)) {
    throw new Error('Schema: authentication-only staging must advertise only GET /notion/status');
  }
  // The restricted Action contract must match the reviewed local schema, not just its
  // top-level URL and path count. Operation-level server overrides and optional
  // security alternatives can change how a client routes or authenticates requests.
  if (authOnly && !isDeepStrictEqual(schema, getOpenApiSpec(base, true))) {
    throw new Error('Schema: authentication-only contract differs from the reviewed local schema');
  }
  const anonymous = await get('/notion/status', 'Anonymous admission');
  if (anonymous.status !== 401) throw new Error('Anonymous admission: expected HTTP 401, got ' + anonymous.status);
  const invalidKey = randomBytes(32).toString('hex');
  if (invalidKey === key) throw new Error('Invalid-key generation collision; retry');
  const wrong = await get('/notion/status', 'Wrong-key admission', invalidKey);
  if (wrong.status !== 401) throw new Error('Wrong-key admission: expected HTTP 401, got ' + wrong.status);
  const valid = await get('/notion/status', 'Staging-key admission', key);
  if (valid.status !== 200) throw new Error('Staging-key admission: expected HTTP 200, got ' + valid.status);
  const status = await json(valid, 'Notion status');
  if (typeof status?.configured !== 'boolean' || typeof status?.databases?.memory !== 'boolean' ||
      typeof status?.databases?.journal !== 'boolean') {
    throw new Error('Notion status: unexpected response shape');
  }
  if (authOnly && (status.configured || status.databases.memory || status.databases.journal)) {
    throw new Error('Notion status: authentication-only staging must have no integration configuration');
  }
  // Report booleans only. Never output the key, schema, response body or private records.
  return { schema: 'pass', buildIdentity: 'matched', anonymous: 'denied', wrongKey: 'denied', stagingKey: 'admitted',
    notionConfigured: status.configured, memoryDatabaseConfigured: status.databases.memory,
    journalDatabaseConfigured: status.databases.journal };
}

if (require.main === module) {
  checkStaging({ origin: process.env.NOVA_STAGING_ORIGIN, key: process.env.NOVA_MEMORY_API_KEY,
    expectedSha: process.env.NOVA_STAGING_EXPECTED_SHA, authOnly: process.env.NOVA_STAGING_AUTH_ONLY === '1' })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error('STAGING GATE FAILED: ' + error.message); process.exitCode = 1; });
}
module.exports = { checkStaging };
