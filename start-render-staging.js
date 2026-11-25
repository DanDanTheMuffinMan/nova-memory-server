'use strict';

// Render start command for a separately authorized, disposable authentication-only
// staging service: node start-render-staging.js
// Set NOVA_STAGING_ONLY=1, NOVA_STAGING_RENDER_SERVICE_ID, NOVA_STAGING_ORIGIN,
// NOVA_STAGING_EXPECTED_SHA, and a fresh NOVA_STAGING_API_KEY (64 hex characters).
// Render supplies RENDER_SERVICE_ID, RENDER_EXTERNAL_URL, RENDER_GIT_COMMIT and PORT.
// Never share a production environment group, disk, credentials or service.
// No Notion or UNOVA delivery is enabled in this first-stage launcher.
const { spawn } = require('node:child_process');
const path = require('node:path');

function stagingEnvironment(env) {
  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }
  requireValue(env.NOVA_STAGING_ONLY === '1', 'Explicit staging opt-in required');
  requireValue(/^srv-[a-z0-9]+$/.test(env.NOVA_STAGING_RENDER_SERVICE_ID || '') &&
    env.RENDER_SERVICE_ID === env.NOVA_STAGING_RENDER_SERVICE_ID &&
    env.RENDER_SERVICE_ID !== 'srv-d4sm59re5dus73ap6ra0', 'Separate designated Render service required');
  let origin;
  try { origin = new URL(env.NOVA_STAGING_ORIGIN); } catch { throw new Error('Valid staging HTTPS origin required'); }
  requireValue(origin.protocol === 'https:' && !origin.username && !origin.password &&
    origin.pathname === '/' && !origin.search && !origin.hash &&
    origin.hostname.endsWith('.onrender.com') && origin.hostname !== 'nova-memory-server.onrender.com' &&
    (env.RENDER_EXTERNAL_URL === origin.origin || env.RENDER_EXTERNAL_URL === origin.origin + '/'),
    'Designated HTTPS origin must match the separate Render service');
  requireValue(/^[a-f0-9]{40}$/.test(env.NOVA_STAGING_EXPECTED_SHA || '') &&
    env.RENDER_GIT_COMMIT === env.NOVA_STAGING_EXPECTED_SHA, 'Reviewed commit must match Render checkout');
  requireValue(/^[a-f0-9]{64}$/.test(env.NOVA_STAGING_API_KEY || ''), 'Separate 64-hex-character staging key required');
  requireValue(!Object.keys(env).some(name => /^(NOTION_|UNOVA_|NOVA_MEMORY_API_KEY$)/.test(name) && env[name]),
    'Remove inherited integration settings and general API credentials from this staging service');
  requireValue(/^\d{1,5}$/.test(env.PORT || '') && Number(env.PORT) >= 1 && Number(env.PORT) <= 65535,
    'Valid Render-assigned PORT required');

  // Explicit allowlist: no ambient integration credentials, NODE_OPTIONS,
  // proxy settings or custom module paths enter the server process.
  return {
    PATH: env.PATH || '/usr/bin:/bin',
    NODE_ENV: 'production',
    PORT: env.PORT,
    NOVA_MEMORY_HOST: '0.0.0.0',
    NOVA_MEMORY_PUBLIC_ORIGIN: origin.origin,
    NOVA_MEMORY_API_KEY: env.NOVA_STAGING_API_KEY,
    NOVA_STAGING_BUILD_SHA: env.RENDER_GIT_COMMIT,
    RENDER_GIT_COMMIT: env.RENDER_GIT_COMMIT
  };
}

function selfTest() {
  const assert = require('node:assert/strict');
  const id = 'srv-disposable123';
  const sha = 'a'.repeat(40);
  const origin = 'https://nova-disposable-test.onrender.com';
  const env = {
    NOVA_STAGING_ONLY: '1', NOVA_STAGING_RENDER_SERVICE_ID: id, RENDER_SERVICE_ID: id,
    NOVA_STAGING_ORIGIN: origin, RENDER_EXTERNAL_URL: origin, NOVA_STAGING_EXPECTED_SHA: sha,
    RENDER_GIT_COMMIT: sha, NOVA_STAGING_API_KEY: 'b'.repeat(64), PORT: '10000',
    NODE_OPTIONS: '--untrusted-example', HTTPS_PROXY: 'https://example.invalid',
    NODE_PATH: '/untrusted', RANDOM_SECRET: 'not-for-child'
  };
  let count = 0;
  const child = stagingEnvironment(env);
  assert.deepEqual(child, { PATH: '/usr/bin:/bin', NODE_ENV: 'production', PORT: '10000',
    NOVA_MEMORY_HOST: '0.0.0.0', NOVA_MEMORY_PUBLIC_ORIGIN: origin,
    NOVA_MEMORY_API_KEY: env.NOVA_STAGING_API_KEY, NOVA_STAGING_BUILD_SHA: sha, RENDER_GIT_COMMIT: sha });
  count++;
  const rejected = [
    { NOVA_STAGING_ONLY: '' }, { RENDER_SERVICE_ID: 'srv-other' },
    { RENDER_SERVICE_ID: 'srv-d4sm59re5dus73ap6ra0', NOVA_STAGING_RENDER_SERVICE_ID: 'srv-d4sm59re5dus73ap6ra0' },
    { NOVA_STAGING_ORIGIN: 'https://nova-memory-server.onrender.com', RENDER_EXTERNAL_URL: 'https://nova-memory-server.onrender.com' },
    { RENDER_EXTERNAL_URL: 'https://other.onrender.com' },
    { NOVA_STAGING_ORIGIN: origin + '/private' }, { RENDER_GIT_COMMIT: 'c'.repeat(40) },
    { NOVA_STAGING_EXPECTED_SHA: 'main' }, { NOVA_STAGING_API_KEY: 'short' },
    { NOVA_MEMORY_API_KEY: 'ambient-key' }, { NOTION_TOKEN: 'ambient-token' },
    { UNOVA_WEBHOOK_URL: 'https://example.invalid' }, { PORT: '65536' }, { PORT: '0' }
  ];
  for (const overrides of rejected) {
    assert.throws(() => stagingEnvironment({ ...env, ...overrides }));
    count++;
  }
  console.log('PASS: ' + count + '/' + count + ' isolated staging launch configuration checks');
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') {
    selfTest();
  } else {
    try {
      if (process.argv.length !== 2) throw new Error('Unexpected launcher arguments');
      const env = stagingEnvironment(process.env);
      const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
        cwd: __dirname, env, stdio: 'inherit'
      });
      for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
      child.on('error', () => { console.error('Staging child failed to start'); process.exitCode = 1; });
      child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    } catch (error) {
      console.error('STAGING LAUNCH REFUSED: ' + error.message);
      process.exitCode = 1;
    }
  }
}
module.exports = { stagingEnvironment };
