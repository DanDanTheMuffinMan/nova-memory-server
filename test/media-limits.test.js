'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MEDIA_FILE_LIMIT_BYTES: FILE,
  MEDIA_USER_LIMIT_BYTES: USER,
  MEDIA_GLOBAL_LIMIT_BYTES: GLOBAL,
  MEDIA_USER_LIMIT_ITEMS: USER_ITEMS,
  MEDIA_GLOBAL_LIMIT_ITEMS: GLOBAL_ITEMS,
  canAcceptMedia
} = require('../media-limits');

const store = () => Object.create(null);
const items = (count, bytes) => Array.from({ length: count }, () => ({ size: bytes }));

test('allows a normal image without modifying the store', () => {
  const s = store();
  const before = JSON.stringify(s);
  assert.equal(canAcceptMedia(s, 'dan', 1024).ok, true);
  assert.equal(JSON.stringify(s), before);
});

test('allows a file at the exact per-file limit', () => {
  assert.equal(canAcceptMedia(store(), 'dan', FILE).ok, true);
});

test('rejects an over-limit file with 413', () => {
  assert.equal(canAcceptMedia(store(), 'dan', FILE + 1).status, 413);
});

test('rejects user-byte overflow and does not discard earlier media', () => {
  const s = store();
  s.dan = items(3, USER / 3);
  assert.equal(canAcceptMedia(s, 'dan', 1).status, 413);
  assert.equal(s.dan.length, 3);
});

test('rejects global-byte overflow across separate users', () => {
  const s = store();
  s.a = items(4, FILE);
  s.b = items(4, FILE);
  assert.equal(canAcceptMedia(s, 'c', 1).status, 413);
  assert.equal(GLOBAL, 8 * FILE);
});

test('rejects user item-count overflow even for tiny files', () => {
  const s = store();
  s.dan = items(USER_ITEMS, 1);
  assert.equal(canAcceptMedia(s, 'dan', 1).status, 413);
});

test('rejects global item-count overflow across users', () => {
  const s = store();
  for (let i = 0; i < GLOBAL_ITEMS; i += 1) s['user' + i] = [{ size: 1 }];
  assert.equal(canAcceptMedia(s, 'next', 1).status, 413);
});

test('rejects missing user id and empty or invalid file sizes', () => {
  assert.equal(canAcceptMedia(store(), '', 12).status, 400);
  assert.equal(canAcceptMedia(store(), 'dan', 0).status, 400);
  assert.equal(canAcceptMedia(store(), 'dan', NaN).status, 400);
  assert.equal(canAcceptMedia(store(), 'dan', 1.5).status, 400);
});

test('handles prototype-like user IDs without inherited array contents', () => {
  const s = store();
  assert.equal(canAcceptMedia(s, '__proto__', 1).ok, true);
  s.__proto__ = [{ size: 5 }];
  assert.equal(canAcceptMedia(s, '__proto__', 1).ok, true);
});
