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
