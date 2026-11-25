'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getOpenApiSpec, parsePublicOrigin } = require('../openapi');

test('the standalone Actions export preserves the live bearer and retry contracts', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-openapi-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const origin = 'https://nova.example.test';
  execFileSync(process.execPath, [path.resolve(__dirname, '../export-openapi.js'), origin], { cwd });
  const spec = JSON.parse(fs.readFileSync(path.join(cwd, 'openapi.json'), 'utf8'));

  assert.deepEqual(spec, getOpenApiSpec(origin));
  assert.deepEqual(spec.servers, [{ url: origin }]);
  assert.deepEqual(spec.security, [{ bearerAuth: [] }]);
  assert.deepEqual(spec.components.securitySchemes.bearerAuth, { type: 'http', scheme: 'bearer' });
  const bridge = spec.paths['/bridge/entry'].post;
  assert.ok(bridge.parameters.some(p => p.in === 'header' && p.name === 'Idempotency-Key'));
});

test('an explicitly configured public origin is suitable for TLS-terminated Actions imports', () => {
  assert.equal(parsePublicOrigin(undefined), undefined);
  assert.equal(parsePublicOrigin('https://NOVA.example.test:443/'), 'https://nova.example.test');
  for (const value of ['bad', 'http://nova.test', 'https://user@nova.test', 'https://nova.test/path',
    'https://nova.test/?key=value', 'https://nova.test/#fragment']) {
    assert.throws(() => parsePublicOrigin(value), /must be an HTTPS origin/);
  }
});
