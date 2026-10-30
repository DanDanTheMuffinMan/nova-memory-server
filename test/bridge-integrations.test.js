'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridgeIntegrations } = require('../bridge-integrations');

const record = {
  title: 'Field observation',
  content: 'Documented without sending to any service',
  tags: ['operations'],
  userId: 'sample-user',
  entryType: 'memory'
};

test('unconfigured integrations skip delivery without throwing or calling transport', async () => {
  const { createNotionEntry, sendUnovaEvent } = createBridgeIntegrations({
    env: {},
    post: async () => { throw new Error('transport must not run'); }
  });
  assert.deepEqual(await createNotionEntry(record), { enabled: false });
  assert.deepEqual(await sendUnovaEvent({ payload: record }), { enabled: false });
});

test('Notion bridge uses a defined URL and default API version', async () => {
  const calls = [];
  const { createNotionEntry } = createBridgeIntegrations({
    env: {
      NOTION_TOKEN: 'fake-test-token',
      NOTION_DATABASE_ID: 'test-database',
      NOTION_TAGS_PROPERTY: 'Tags',
      NOTION_USER_PROPERTY: 'User',
      NOTION_ENTRY_TYPE_PROPERTY: 'EntryType'
    },
    post: async (...args) => {
      calls.push(args);
      return { data: { id: 'test-page', url: 'https://notion.so/test-page' } };
    }
  });
  const result = await createNotionEntry(record);
  assert.deepEqual(result, {
    enabled: true, success: true, pageId: 'test-page', url: 'https://notion.so/test-page'
  });
  assert.equal(calls.length, 1);
  const [url, body, config] = calls[0];
  assert.equal(url, 'https://api.notion.com/v1/pages');
  assert.equal(config.headers['Notion-Version'], '2022-06-28');
  assert.equal(config.headers.Authorization, 'Bearer fake-test-token');
  assert.equal(body.parent.database_id, 'test-database');
  assert.equal(body.properties.Name.title[0].text.content, record.title);
  assert.equal(body.properties.Tags.multi_select[0].name, 'operations');
  assert.equal(body.properties.User.rich_text[0].text.content, 'sample-user');
  assert.equal(body.properties.EntryType.select.name, 'memory');
});

test('Notion bridge honors explicit version/database overrides', async () => {
  const calls = [];
  const { createNotionEntry } = createBridgeIntegrations({
    env: {},
    post: async (...args) => { calls.push(args); return { data: { id: 'custom-page' } }; }
  });
  const result = await createNotionEntry({
    ...record,
    overrides: { token: 'override-token', databaseId: 'custom-db', version: '2022-02-22' }
  });
  assert.equal(result.success, true);
  assert.equal(calls[0][1].parent.database_id, 'custom-db');
  assert.equal(calls[0][2].headers['Notion-Version'], '2022-02-22');
});

test('Notion delivery failure is reported, not rethrown as bridge write failure', async () => {
  const { createNotionEntry } = createBridgeIntegrations({
    env: { NOTION_TOKEN: 'fake', NOTION_DATABASE_ID: 'db' },
    post: async () => { throw new Error('simulated remote outage'); }
  });
  const result = await createNotionEntry(record);
  assert.equal(result.enabled, true);
  assert.equal(result.success, false);
  assert.equal(result.error, 'simulated remote outage');
});

test('UNOVA bridge posts configured event with bearer header', async () => {
  const calls = [];
  const { sendUnovaEvent } = createBridgeIntegrations({
    env: {
      UNOVA_WEBHOOK_URL: 'https://example.invalid/hook',
      UNOVA_API_KEY: 'fake-event-token',
      UNOVA_EVENT_NAME: 'nova.test'
    },
    post: async (...args) => { calls.push(args); return { status: 202 }; }
  });
  assert.deepEqual(await sendUnovaEvent({ payload: record }), {
    enabled: true, success: true, status: 202
  });
  assert.equal(calls[0][0], 'https://example.invalid/hook');
  assert.equal(calls[0][1].event, 'nova.test');
  assert.equal(calls[0][1].payload.userId, 'sample-user');
  assert.equal(calls[0][2].headers.Authorization, 'Bearer fake-event-token');
});

test('UNOVA bridge omits authorization without a configured key', async () => {
  let headers;
  const { sendUnovaEvent } = createBridgeIntegrations({
    env: { UNOVA_WEBHOOK_URL: 'https://example.invalid/hook' },
    post: async (url, body, options) => { headers = options.headers; return { status: 200 }; }
  });
  assert.equal((await sendUnovaEvent({ payload: record })).success, true);
  assert.equal(Object.hasOwn(headers, 'Authorization'), false);
});

test('UNOVA remote failure returns a structured unsuccessful integration result', async () => {
  const { sendUnovaEvent } = createBridgeIntegrations({
    env: { UNOVA_WEBHOOK_URL: 'https://example.invalid/hook' },
    post: async () => { throw new Error('simulated webhook outage'); }
  });
  const result = await sendUnovaEvent({ payload: record });
  assert.equal(result.enabled, true);
  assert.equal(result.success, false);
  assert.equal(result.error, 'simulated webhook outage');
});
