'use strict';

// Optional Notion/UNOVA delivery for /bridge/entry, isolated for dependency-free tests.
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const DEFAULT_NOTION_VERSION = '2022-06-28';

function createBridgeIntegrations({
  env = process.env,
  post = (...args) => require('axios').post(...args)
} = {}) {
  const resolveNotionConfig = (overrides = {}) => ({
    token: overrides.token || env.NOTION_TOKEN,
    databaseId: overrides.databaseId || env.NOTION_DATABASE_ID,
    titleProperty: overrides.titleProperty || env.NOTION_TITLE_PROPERTY || 'Name',
    tagsProperty: overrides.tagsProperty || env.NOTION_TAGS_PROPERTY,
    userProperty: overrides.userProperty || env.NOTION_USER_PROPERTY,
    entryTypeProperty: overrides.entryTypeProperty || env.NOTION_ENTRY_TYPE_PROPERTY,
    version: overrides.version || env.NOTION_VERSION || DEFAULT_NOTION_VERSION
  });
  
  const resolveUnovaConfig = (overrides = {}) => ({
    webhookUrl: overrides.webhookUrl || env.UNOVA_WEBHOOK_URL,
    apiKey: overrides.apiKey || env.UNOVA_API_KEY,
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
  
  const createNotionEntry = async ({ title, content, tags, userId, entryType, overrides }) => {
    const config = resolveNotionConfig(overrides);
    if (!config.token || !config.databaseId) {
      return { enabled: false };
    }
  
    const properties = buildNotionProperties({ title, tags, userId, entryType, config });
    const children = buildNotionChildren({ content });
  
    try {
      const response = await post(
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
    if (!config.webhookUrl) {
      return { enabled: false };
    }
  
    try {
      const response = await post(
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
