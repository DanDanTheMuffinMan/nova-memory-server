'use strict';

// Optional Notion/UNOVA delivery for /bridge/entry, isolated for dependency-free tests.
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const DEFAULT_NOTION_VERSION = '2022-06-28';
const DELIVERY_TIMEOUT_MS = 10_000;

function createBridgeIntegrations({
  env = process.env,
  deliveryTimeoutMs = DELIVERY_TIMEOUT_MS,
  post = (...args) => require('axios').post(...args)
} = {}) {
  async function postWithDeadline(url, body, options) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Bridge delivery timed out; remote outcome unknown'));
        controller.abort();
      }, deliveryTimeoutMs);
    });
    try {
      return await Promise.race([
        post(url, body, { ...options, signal: controller.signal }),
        deadline
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  const databases = new Map([
    ['memory', env.NOTION_MEMORY_DATABASE_ID],
    ['journal', env.NOTION_JOURNAL_DATABASE_ID]
  ]);
  const resolveNotionConfig = (entryType, overrides = {}) => ({
    token: env.NOTION_TOKEN,
    databaseId: databases.get(entryType) || env.NOTION_DATABASE_ID,
    titleProperty: overrides.titleProperty || env.NOTION_TITLE_PROPERTY || 'Name',
    tagsProperty: overrides.tagsProperty || env.NOTION_TAGS_PROPERTY,
    userProperty: overrides.userProperty || env.NOTION_USER_PROPERTY,
    entryTypeProperty: overrides.entryTypeProperty || env.NOTION_ENTRY_TYPE_PROPERTY,
    version: overrides.version || env.NOTION_VERSION || DEFAULT_NOTION_VERSION
  });
  
  const resolveUnovaConfig = (overrides = {}) => ({
    // Outbound destination and server bearer token are operator-owned.
    webhookUrl: env.UNOVA_WEBHOOK_URL,
    apiKey: env.UNOVA_API_KEY,
    rejectedDestination: Boolean(overrides.webhookUrl && overrides.webhookUrl !== env.UNOVA_WEBHOOK_URL),
    rejectedKey: Boolean(overrides.apiKey && overrides.apiKey !== env.UNOVA_API_KEY),
    eventName: overrides.eventName || env.UNOVA_EVENT_NAME || 'nova.entry.created'
  });
  
  const buildNotionProperties = ({ title, tags, userId, entryType, config }) => {
    const properties = {
      [config.titleProperty]: {
        title: [{ text: { content: title } }]
      }
    };
  
    if (Array.isArray(tags) && tags.length && config.tagsProperty) {
      properties[config.tagsProperty] = {
        multi_select: tags.map((tag) => ({ name: tag }))
      };
    }
  
    if (userId && config.userProperty) {
      properties[config.userProperty] = {
        rich_text: [{ text: { content: userId } }]
      };
    }
  
    if (entryType && config.entryTypeProperty) {
      properties[config.entryTypeProperty] = {
        select: { name: entryType }
      };
    }
  
    return properties;
  };
  
  const buildNotionChildren = ({ content }) => {
    if (!content) return [];
    return [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content } }]
        }
      }
    ];
  };
  
  const createNotionEntry = async ({ title, content, tags, userId, entryType, overrides = {} }) => {
    // Do not let an API caller borrow the server's Notion integration identity
    // to write into a different database, or inject credentials into the bridge.
    const databaseId = databases.get(entryType) || env.NOTION_DATABASE_ID;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
        Object.hasOwn(overrides, 'token') ||
        (Object.hasOwn(overrides, 'databaseId') && overrides.databaseId !== databaseId)) {
      return { enabled: false, success: false, error: 'Notion database and token must be configured on the server' };
    }
    const config = resolveNotionConfig(entryType, overrides);
    if (!config.token || !config.databaseId) {
      return { enabled: false };
    }
  
    const properties = buildNotionProperties({ title, tags, userId, entryType, config });
    const children = buildNotionChildren({ content });
  
    try {
      const response = await postWithDeadline(
        NOTION_API_URL,
        {
          parent: { database_id: config.databaseId },
          properties,
          children
        },
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Notion-Version': config.version,
            'Content-Type': 'application/json'
          }
        }
      );
  
      return {
        enabled: true,
        success: true,
        pageId: response.data?.id,
        url: response.data?.url
      };
    } catch (error) {
      return {
        enabled: true,
        success: false,
        error: error.response?.data || error.message
      };
    }
  };
  
  const sendUnovaEvent = async ({ payload, overrides }) => {
    const config = resolveUnovaConfig(overrides);
    if (config.rejectedDestination || config.rejectedKey) {
      return { enabled: false, success: false, error: 'UNOVA webhook URL and API key must be configured on the server' };
    }
    if (!config.webhookUrl) {
      return { enabled: false };
    }
  
    try {
      const response = await postWithDeadline(
        config.webhookUrl,
        {
          event: config.eventName,
          payload
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
          }
        }
      );
  
      return {
        enabled: true,
        success: true,
        status: response.status
      };
    } catch (error) {
      return {
        enabled: true,
        success: false,
        error: error.response?.data || error.message
      };
    }
  };

  return { createNotionEntry, sendUnovaEvent };
}

module.exports = { createBridgeIntegrations };
