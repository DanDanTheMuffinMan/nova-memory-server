'use strict';
// Learn the port from the actual child after it has bound an OS-assigned listener.
// Never probe a guessed or released port, which could belong to another process.
function waitForLoopbackPort(child, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('Loopback listener readiness timed out')), timeoutMs);
    function finish(error, port) {
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve(port);
    }
    function onError() { finish(new Error('Could not spawn loopback server')); }
    function onExit() { finish(new Error('Loopback server exited before announcing its listener')); }
    function onData(chunk) {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        const m = /^Nova Memory Server listening on 127\.0\.0\.1 port (\d+)$/.exec(line);
        if (m) {
          const port = Number(m[1]);
          if (Number.isInteger(port) && port > 0 && port <= 65535) return finish(null, port);
        }
      }
      if (buffer.length > 8192) return finish(new Error('Invalid loopback readiness output'));
    }
    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout.on('data', onData);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}
module.exports = { waitForLoopbackPort };
