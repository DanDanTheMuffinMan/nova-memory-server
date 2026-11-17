'use strict';

const { createHash } = require('node:crypto');

class BridgeIdempotencyError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'BridgeIdempotencyError';
    this.statusCode = statusCode;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// Process-local retry protection. It is not durable across server restarts.
// Completed requests stay reserved for ttlMs. Pending reservations are never
// evicted, and capacity is enforced rather than silently dropping live keys.
function createBridgeIdempotency({
  now = Date.now,
  ttlMs = 10 * 60 * 1000,
  maxEntries = 1024
} = {}) {
  if (!(ttlMs > 0) || !(maxEntries > 0)) throw new Error('Invalid idempotency limits');
  const entries = new Map();

  function pruneExpired() {
    for (const [key, entry] of entries) {
      if (!entry.pending && entry.expiresAt <= now()) entries.delete(key);
    }
  }

  function execute({ key, userId, entryType, body }, operation) {
    if (!key) return Promise.resolve().then(operation);
    if (typeof key !== 'string' || key.length > 128 ||
        !/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new BridgeIdempotencyError('Invalid Idempotency-Key header', 400);
    }
    const reservation = JSON.stringify([userId, entryType, key]);
    const digest = createHash('sha256').update(canonicalJson(body)).digest('hex');

    pruneExpired();
    const existing = entries.get(reservation);
    if (existing) {
      if (existing.digest !== digest) {
        throw new BridgeIdempotencyError('Idempotency-Key reused with different request data', 409);
      }
      return existing.promise;
    }
    if (entries.size >= maxEntries) {
      throw new BridgeIdempotencyError('Idempotency capacity exhausted; retry later', 503);
    }

    const entry = { digest, pending: true, expiresAt: Infinity, promise: null };
    entries.set(reservation, entry);
    entry.promise = Promise.resolve().then(operation).then(
      result => {
        entry.pending = false;
        entry.expiresAt = now() + ttlMs;
        return result;
      },
      error => {
        // Unknown side effects may already have occurred. Reserve this key
        // for the TTL even after a failure rather than duplicate a write.
        entry.pending = false;
        entry.expiresAt = now() + ttlMs;
        throw error;
      }
    );
    return entry.promise;
  }

  return { execute };
}

module.exports = { createBridgeIdempotency, BridgeIdempotencyError };
