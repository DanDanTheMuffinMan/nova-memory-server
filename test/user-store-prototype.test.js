'use strict';

// Regression for backing maps used by /memory, /journal and /bridge/entry.
// Read the real index.js declarations so a reintroduction of `{}` fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
function freshStore(name) {
  const declaration = source.match(new RegExp('const ' + name + ' = ([^;]+);'));
  assert.ok(declaration, name + ' declaration must exist');
  return vm.runInNewContext('(' + declaration[1] + ')');
}

for (const name of ['memoryStore', 'journalStore']) {
  test(name + ' isolates special user IDs instead of inheriting built-ins', () => {
    const store = freshStore(name);
    const ids = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'normal-user'];
    for (const userId of ids) {
      assert.equal(store[userId], undefined, 'unexpected inherited data for ' + userId);
      // This is the exact append pattern used by memory and journal routes.
      if (!store[userId]) store[userId] = [];
      store[userId].push({ topic: userId });
    }
    for (const userId of ids) {
      assert.equal(store[userId].length, 1, 'no entry for ' + userId);
      assert.equal(store[userId][0].topic, userId, 'entries crossed user IDs');
    }
    assert.equal(Object.getPrototypeOf(store), null);
  });
  test(name + ' preserves ordinary reads, writes and user isolation', () => {
    const store = freshStore(name);
    assert.equal((store['other-user'] || []).length, 0);
    store['user-1'] = [];
    store['user-1'].push({ topic: 'hello', value: 'world' });
    assert.equal(store['user-1'][0].value, 'world');
    assert.equal(store['user-2'], undefined);
  });
}
