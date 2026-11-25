'use strict';

const { timingSafeEqual } = require('node:crypto');

// This server has memory, screen capture, and keyboard-control endpoints.
// Never permit them to operate unauthenticated merely because a tunnel is open.
const PUBLIC_GET_PATHS = new Set(['/', '/openapi.json']);

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match ? match[1] : null;
}

function createApiSecurity(secret = process.env.NOVA_MEMORY_API_KEY) {
  const expected = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : null;
  const configured = Boolean(expected && expected.length >= 32);

  function authorized(token) {
    if (!configured || typeof token !== 'string') return false;
    const supplied = Buffer.from(token, 'utf8');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  function http(req, res, next) {
    // Documentation and status landing page contain no user data.
    if (req.method === 'GET' && PUBLIC_GET_PATHS.has(req.path)) return next();

    if (!configured) {
      return res.status(503).json({ error: 'NOVA_MEMORY_API_KEY is not configured' });
    }

    if (!authorized(bearerToken(req.get('authorization')))) {
      return res.status(401)
        .set('WWW-Authenticate', 'Bearer realm="nova-memory-server"')
        .json({ error: 'Unauthorized' });
    }
    return next();
  }

  function socket(socket, next) {
    if (!configured) return next(new Error('NOVA_MEMORY_API_KEY is not configured'));
    const handshake = socket.handshake || {};
    // Socket.IO client auth payload is preferred; HTTP Authorization is also supported.
    const token = typeof handshake.auth?.token === 'string'
      ? handshake.auth.token
      : bearerToken(handshake.headers?.authorization);
    return authorized(token) ? next() : next(new Error('Unauthorized'));
  }

  return { http, socket, configured };
}

module.exports = { createApiSecurity };
