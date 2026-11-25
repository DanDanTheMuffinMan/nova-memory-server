'use strict';

// Preloaded only in the loopback test's server process. Record the actual Axios
// request after serialization. Any attempt to open an outbound socket fails.
const { appendFileSync } = require('node:fs');
const { Socket } = require('node:net');
const axios = require('axios');

function record(value) {
  appendFileSync(process.env.TEST_NOTION_RECEIPT, JSON.stringify(value) + '\n');
}

Socket.prototype.connect = function denyOutboundSocket() {
  record({ unexpectedSocket: true });
  throw new Error('Outbound sockets are disabled in this test server');
};

axios.defaults.adapter = async config => {
  record({
    method: config.method,
    url: config.url,
    hasFixtureCredential: config.headers.get('Authorization') === 'Bearer offline-notion-token',
    version: config.headers.get('Notion-Version'),
    body: JSON.parse(config.data)
  });
  if (config.url !== 'https://api.notion.com/v1/pages' || config.method !== 'post') {
    throw new Error('Unexpected outbound request in offline Notion fixture');
  }
  return { status: 200, data: { id: 'offline-page' }, headers: {}, config };
};

 // Legacy SDK fixture: the bridge uses Axios, while four legacy routes use
 // @notionhq/client. Intercept that module only in this disposable child.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name !== '@notionhq/client') return originalLoad.call(this, name, ...args);
  return { Client: class {
    constructor(options) {
      this.pages = { create: async body => {
        const title = body.properties.Name.title[0].text.content;
        record({ legacy: true, databaseId: body.parent.database_id,
          hasFixtureCredential: options.auth === 'offline-notion-token' });
        if (title === 'legacy-success') return { id: 'legacy-offline-page' };
        const message = 'synthetic-reflected-private-body ' + options.auth;
        const logger = options.logger || ((...values) => console.error(...values));
        logger('warn', message, { body: message });
        throw new Error(message);
      }};
    }
  }};
};
