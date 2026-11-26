'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { waitForLoopbackPort } = require('./fixtures/loopback-readiness.cjs');
test('parallel children own distinct OS-assigned loopback listeners', async () => {
  const code = "const s=require('node:http').createServer((q,r)=>r.end(String(process.pid)));s.listen(0,'127.0.0.1',()=>{console.log('Nova Memory Server listening on 127.0.0.1 port '+s.address().port)})";
  const children = Array.from({length: 6}, () => spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','ignore']}));
  try {
    const ports = await Promise.all(children.map(c => waitForLoopbackPort(c)));
    assert.equal(new Set(ports).size, children.length);
    const bodies = await Promise.all(ports.map(async p => (await fetch('http://127.0.0.1:'+p,{signal:AbortSignal.timeout(3000)})).text()));
    assert.deepEqual(bodies, children.map(c=>String(c.pid)));
  } finally {
    await Promise.all(children.map(async c => { if (c.exitCode === null && c.signalCode === null) { const done=once(c,'exit'); c.kill(); await done; } }));
  }
});
test('early exit or non-loopback announcement fails closed', async () => {
  const c = spawn(process.execPath,['-e',"console.log('Nova Memory Server listening on 0.0.0.0 port 1234')"],{stdio:['ignore','pipe','ignore']});
  await assert.rejects(waitForLoopbackPort(c), /exited before announcing/);
});
test('readiness timeout rejects a silent child', async () => {
  const c = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});
  try { await assert.rejects(waitForLoopbackPort(c,100), /timed out/); }
  finally { const done=once(c,'exit'); c.kill(); await done; }
});
