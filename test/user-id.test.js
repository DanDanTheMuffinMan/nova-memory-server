'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidUserId } = require('../user-id');

test('OpenAPI string user IDs retain their exact identity', () => {
  for (const userId of ['alpha', 'alpha,beta', '[object Object]', '__proto__', 'constructor', '007']) {
    assert.equal(isValidUserId(userId), true, userId);
  }
});

test('arrays, objects, numbers, null and blank IDs are rejected', () => {
  for (const userId of [
    ['alpha', 'beta'], { some: 'value' }, Object.create(null), 7, 0,
    true, null, undefined, '', '   ', '\n\t'
  ]) {
    assert.equal(isValidUserId(userId), false, String(userId));
  }
});

test('the previously aliased property names are distinct after validation', () => {
  const store = Object.create(null);
  store['alpha,beta'] = [{ source: 'string ID' }];
  store['[object Object]'] = [{ source: 'literal string ID' }];
  assert.equal(store[['alpha', 'beta']][0].source, 'string ID', 'demonstrate original coercion');
  assert.equal(store[{ any: 'object' }][0].source, 'literal string ID', 'demonstrate original coercion');
  assert.equal(isValidUserId(['alpha', 'beta']), false, 'arrays cannot index the store anymore');
  assert.equal(isValidUserId({ any: 'object' }), false, 'objects cannot index the store anymore');
});
