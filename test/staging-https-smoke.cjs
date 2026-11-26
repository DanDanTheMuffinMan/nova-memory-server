'use strict';

// Real HTTPS admission rehearsal against the actual candidate, never an external service.
// A temporary CA is trusted only by the gate subprocess; no global TLS bypass.
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const { waitForLoopbackPort } = require('./fixtures/loopback-readiness.cjs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(execFile);

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => {
  if (!server || !server.listening) return resolve();
  server.close(resolve);
  server.closeAllConnections?.();
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-tls-'));
  let proxy, backend;
  try {
    // Portable OpenSSL config works with both OpenSSL and LibreSSL.
    const config = path.join(tmp, 'tls.cnf');
    const cert = path.join(tmp, 'ca.pem');
    const privateKey = path.join(tmp, 'key.pem');
    await fs.writeFile(config, [
      '[req]', 'distinguished_name=dn', 'prompt=no', 'x509_extensions=ext',
      '[dn]', 'CN=UNOVA disposable localhost TLS', '[ext]',
      'subjectAltName=IP:127.0.0.1', 'basicConstraints=critical,CA:TRUE',
      'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
      'extendedKeyUsage=serverAuth'
    ].join('\n') + '\n');
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-days', '1', '-config', config, '-keyout', privateKey, '-out', cert],
      { timeout: 15000 });
    // Do not inherit production or integration variables, proxy settings or TLS overrides.
    const env = Object.fromEntries(['PATH','HOME','TMPDIR','TEMP','SystemRoot']
      .filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
    const key = randomBytes(32).toString('hex');
    const build = randomBytes(20).toString('hex');
    let backendPort;
    const trace = [];
    let trapHits = 0;
    let redirectValid = false;
    proxy = https.createServer({ key: await fs.readFile(privateKey), cert: await fs.readFile(cert) }, (req, res) => {
      const auth = req.headers.authorization;
      const kind = !auth ? 'anonymous' : auth === 'Bearer ' + key ? 'valid' : 'wrong';
      if (req.url === '/redirect-trap') {
        trapHits++;
        res.writeHead(204).end();
        return;
      }
      // Strictly read-only frontend; no bridge, control, capture or WebSocket access.
      if (req.method !== 'GET' || !['/openapi.json', '/notion/status'].includes(req.url)) {
        res.writeHead(403).end();
        return;
      }
      trace.push([req.url, kind]);
      if (redirectValid && req.url === '/notion/status' && kind === 'valid') {
        res.writeHead(307, { Location: '/redirect-trap' }).end();
        return;
      }
      const upstream = http.request({ hostname: '127.0.0.1', port: backendPort,
        path: req.url, method: 'GET', headers: {
          Accept: 'application/json', ...(auth ? { Authorization: auth } : {})
        } }, reply => {
        res.writeHead(reply.statusCode, { 'Content-Type': reply.headers['content-type'] || 'application/json',
          ...(reply.headers['x-nova-staging-build'] ? { 'X-Nova-Staging-Build': reply.headers['x-nova-staging-build'] } : {}) });
        reply.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      upstream.setTimeout(5000, () => upstream.destroy());
      upstream.end();
    });
    const port = await listen(proxy);
    const origin = 'https://127.0.0.1:' + port;
    backend = spawn(process.execPath, ['index.js'], {
      env: { ...env, PORT: '0', NOVA_MEMORY_HOST: '127.0.0.1',
        NOVA_MEMORY_PUBLIC_ORIGIN: origin, NOVA_MEMORY_API_KEY: key, NOVA_STAGING_BUILD_SHA: build },
      stdio: ['ignore', 'pipe', 'ignore']
    });
    backendPort = await waitForLoopbackPort(backend);
    const gateEnv = { ...env, NOVA_STAGING_ORIGIN: origin, NOVA_MEMORY_API_KEY: key, NOVA_STAGING_EXPECTED_SHA: build };
    const cli = (trusted, expectedBuild = build) => run(process.execPath, ['check-staging.js'], {
      env: { ...gateEnv, NOVA_STAGING_EXPECTED_SHA: expectedBuild, ...(trusted ? { NODE_EXTRA_CA_CERTS: cert } : {}) }, timeout: 45000
    });
    // Fail-closed on an untrusted certificate, before any HTTP request or bearer is sent.
    await assert.rejects(cli(false), e => e.code === 1 && /Schema: transport failed/.test(e.stderr || '') && !String(e.stderr).includes(key));
    assert.equal(trace.length, 0);
    console.log('PASS: untrusted TLS rejected before any HTTP request');
    await assert.rejects(cli(true, '0'.repeat(40)), e => e.code === 1 && /unexpected build identity/.test(e.stderr || ''));
    assert.deepEqual(trace, [['/openapi.json','anonymous']]);
    trace.length = 0;
    console.log('PASS: stale staging build rejected before bearer admission');
    const result = await cli(true);
    assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key), 'Gate disclosed disposable key');
    assert.deepEqual(JSON.parse(result.stdout), { schema: 'pass', buildIdentity: 'matched', anonymous: 'denied', wrongKey: 'denied',
      stagingKey: 'admitted', notionConfigured: false, memoryDatabaseConfigured: false, journalDatabaseConfigured: false });
    const expected = [['/openapi.json','anonymous'], ['/notion/status','anonymous'],
      ['/notion/status','wrong'], ['/notion/status','valid']];
    assert.deepEqual(trace, expected);
    console.log('PASS: real trusted HTTPS, actual Nova admission and exact read-only request sequence; integrations unconfigured');
    trace.length = 0;
    redirectValid = true;
    await assert.rejects(cli(true), e => e.code === 1 && /Staging-key admission: expected HTTP 200, got 307/.test(e.stderr || '') && !String(e.stderr).includes(key));
    assert.deepEqual(trace, expected);
    assert.equal(trapHits, 0);
    console.log('PASS: actual HTTPS 307 refused, no redirected credential delivery');
  } finally {
    if (backend && backend.exitCode === null) {
      backend.kill('SIGTERM');
      await Promise.race([new Promise(resolve => backend.once('exit', resolve)), pause(2000)]);
      if (backend.exitCode === null && backend.signalCode === null) backend.kill('SIGKILL');
    }
    await close(proxy);
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// Run the real Render launcher with synthetic metadata and credentials on a
// disposable hosted runner. No hosted service, production secret or delivery.
async function launcherBoundary() {
  const net = require('node:net');
  const { io } = require('socket.io-client');
  const { once } = require('node:events');
  const key = randomBytes(32).toString('hex');
  const build = randomBytes(20).toString('hex');
  const origin = 'https://nova-disposable-test.onrender.com';
  const service = 'srv-disposable123';
  let child, port, diagnostics = '';
  async function stop() {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, pause(2500)]);
    if (child.exitCode === null && child.signalCode === null) {
      // Only the dedicated disposable process group, never another listener.
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
      await exited;
    }
  }
  try {
    // The real launcher requires a positive provider-assigned PORT. Reserve an
    // OS-assigned candidate, release just before launch, and retry only a
    // verified bind collision. Never probe until THIS child announces readiness.
    for (let attempt = 0; attempt < 4; attempt++) {
      const reservation = net.createServer();
      port = await listen(reservation);
      await close(reservation);
      diagnostics = '';
      child = spawn(process.execPath, ['start-render-staging.js'], {
        detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH || '/usr/bin:/bin', PORT: String(port),
          NOVA_STAGING_ONLY: '1', NOVA_STAGING_RENDER_SERVICE_ID: service,
          RENDER_SERVICE_ID: service, NOVA_STAGING_ORIGIN: origin, RENDER_EXTERNAL_URL: origin,
          NOVA_STAGING_EXPECTED_SHA: build, RENDER_GIT_COMMIT: build,
          NOVA_STAGING_API_KEY: key, NOVA_STAGING_AUTH_ONLY: '0' }
      });
      child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
      try {
        await new Promise((resolve, reject) => {
          let buffer = '';
          const timer = setTimeout(() => finish(new Error('Launcher readiness timed out')), 15000);
          function finish(error) {
            clearTimeout(timer);
            child.stdout.off('data', data);
            child.off('error', finish);
            child.off('exit', exited);
            if (error) reject(error); else resolve();
          }
          function exited() { finish(new Error('Launcher exited before listener readiness')); }
          function data(chunk) {
            buffer += chunk.toString();
            let end;
            while ((end = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, end).replace(/\r$/, '');
              buffer = buffer.slice(end + 1);
              if (line === 'Nova Memory Server listening on 0.0.0.0 port ' + port) return finish();
            }
            if (buffer.length > 8192) finish(new Error('Invalid launcher readiness output'));
          }
          child.stdout.on('data', data);
          child.once('error', finish);
          child.once('exit', exited);
        });
        break;
      } catch (error) {
        await stop();
        if (attempt === 3 || !diagnostics.includes('EADDRINUSE')) throw error;
      }
    }
    const base = 'http://127.0.0.1:' + port;
    const request = (route, method = 'GET', token) => fetch(base + route, {
      method, headers: token ? { Authorization: 'Bearer ' + token } : {},
      redirect: 'manual', signal: AbortSignal.timeout(6000)
    });
    const schema = await request('/openapi.json');
    assert.equal(schema.status, 200);
    assert.equal(schema.headers.get('X-Nova-Staging-Build'), build);
    const actionSchema = await schema.json();
    assert.equal(actionSchema.servers[0].url, origin);
    assert.deepEqual(Object.keys(actionSchema.paths), ['/notion/status']);
    assert.deepEqual(Object.keys(actionSchema.paths['/notion/status']), ['get']);
    assert.deepEqual(actionSchema.security, [{ bearerAuth: [] }]);
    for (const token of [undefined, 'x'.repeat(64)]) {
      assert.equal((await request('/notion/status', 'GET', token)).status, 401);
    }
    const status = await request('/notion/status', 'GET', key);
    assert.equal(status.status, 200);
    const state = await status.json();
    assert.equal(state.configured, false);
    assert.equal(state.databases.memory, false);
    assert.equal(state.databases.journal, false);
    const forbidden = [
      ['GET','/memory'], ['POST','/memory'], ['GET','/journal'], ['POST','/journal'],
      ['POST','/notion/memory'], ['POST','/notion/journal'], ['POST','/bridge/entry'],
      ['GET','/capture/screen'], ['GET','/capture/screen/info'],
      ['POST','/control/keyboard/type'], ['POST','/control/mouse/click'],
      ['GET','/control/mouse/position'], ['POST','/upload/image'], ['POST','/upload/audio'],
      ['GET','/media'], ['GET','/media/test/0'], ['POST','/notion/status']
    ];
    for (const [method, route] of forbidden) {
      const reply = await request(route, method, key);
      assert.equal(reply.status, 403, method + ' ' + route);
      assert.deepEqual(await reply.json(), { error: 'Authentication-only staging' });
    }
    for (const transport of ['polling','websocket']) {
      await new Promise((resolve, reject) => {
        const socket = io(base, { transports: [transport], auth: { token: key },
          reconnection: false, timeout: 5000 });
        const timer = setTimeout(() => finish(new Error('Staging socket denial timed out')), 8000);
        function finish(error) {
          clearTimeout(timer); socket.disconnect();
          if (error) reject(error); else resolve();
        }
        socket.once('connect', () => finish(new Error('Staging socket admitted')));
        socket.once('connect_error', error => finish(error.message === 'Authentication-only staging'
          ? null : new Error('Unexpected staging socket denial')));
      });
    }
    console.log('PASS: actual Render launcher/backend: matching build, isolated Notion status, 17 REST capability denials and polling/websocket namespace denials');
  } finally { await stop(); }
}

main().then(launcherBoundary).catch(error => { console.error('Disposable staging rehearsal failed:', error.message); process.exitCode = 1; });
