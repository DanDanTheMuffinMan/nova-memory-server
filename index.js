const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const { createScreenStream } = require('./screen-stream');
const multer = require('multer');
const { MEDIA_FILE_LIMIT_BYTES, canAcceptMedia } = require('./media-limits');
const { Client: NotionClient } = require('@notionhq/client');
const { isValidUserId } = require('./user-id');
const { createApiSecurity } = require('./api-security');
const { createBridgeIntegrations } = require('./bridge-integrations');
const { createBridgeIdempotency, BridgeIdempotencyError } = require('./bridge-idempotency');
const { getOpenApiSpec, parsePublicOrigin } = require('./openapi');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const port = process.env.PORT || 3000;
const bindHost = process.env.NOVA_MEMORY_HOST || undefined;
const publicOrigin = parsePublicOrigin(process.env.NOVA_MEMORY_PUBLIC_ORIGIN);
// Explicit staging opt-in; never infer staging merely from a hostname.
const stagingBuild = process.env.NOVA_STAGING_BUILD_SHA;
const renderBuild = process.env.RENDER_GIT_COMMIT;
if (stagingBuild !== undefined && (!/^[a-f0-9]{40}$/.test(stagingBuild) ||
    (renderBuild !== undefined && renderBuild !== stagingBuild))) {
  throw new Error('Invalid staging build identity or mismatch with Render checkout');
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: MEDIA_FILE_LIMIT_BYTES } });

// Multer's limit errors must not fall through to Express's default 500/HTML handler.
const boundedUpload = (field) => (req, res, next) => {
  upload.single(field)(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Media file exceeds 8 MiB limit' });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: 'Invalid media upload' });
    }
    return next(error);
  });
};

app.use(cors());
app.use(express.json());

// Require a dedicated secret for every memory, capture, and control operation.
// Keep only GET / and GET /openapi.json unauthenticated.
const apiSecurity = createApiSecurity();
app.use(apiSecurity.http);
io.use(apiSecurity.socket);
if (!apiSecurity.configured) {
  console.warn('NOVA_MEMORY_API_KEY missing or too short; protected APIs and screen streams are disabled');
}

// Check if display is available and load peripheral control libraries conditionally
let peripheralControlAvailable = false;
let keyboard, Key, mouse, Button, screen, screenshot;

// Check for display availability using environment variable
const hasDisplay = process.env.DISPLAY || process.platform === 'win32' || process.platform === 'darwin';

if (hasDisplay) {
  try {
    // Try to load peripheral control libraries
    const nutjs = require('@nut-tree-fork/nut-js');
    keyboard = nutjs.keyboard;
    Key = nutjs.Key;
    mouse = nutjs.mouse;
    Button = nutjs.Button;
    screen = nutjs.screen;
    screenshot = require('screenshot-desktop');
    peripheralControlAvailable = true;
    console.log('Peripheral control libraries loaded successfully');
  } catch (error) {
    console.warn('Peripheral control not available:', error.message);
    peripheralControlAvailable = false;
  }
} else {
  console.warn('No display detected (DISPLAY environment variable not set), peripheral control disabled');
  peripheralControlAvailable = false;
}

// In-memory data store
// Use null-prototype maps: userId is caller-controlled and may equal '__proto__',
// 'constructor', or other inherited Object property names.
const memoryStore = Object.create(null);
const journalStore = Object.create(null);
const mediaStore = Object.create(null); // Keep user IDs isolated from Object.prototype
const bridgeIdempotency = createBridgeIdempotency();

const notionConfig = {
  token: process.env.NOTION_TOKEN,
  memoryDatabaseId: process.env.NOTION_MEMORY_DATABASE_ID || process.env.NOTION_DATABASE_ID,
  journalDatabaseId: process.env.NOTION_JOURNAL_DATABASE_ID || process.env.NOTION_DATABASE_ID,
  titleProperty: process.env.NOTION_TITLE_PROPERTY || 'Name',
  memoryTopicProperty: process.env.NOTION_MEMORY_TOPIC_PROPERTY || 'Topic',
  memoryValueProperty: process.env.NOTION_MEMORY_VALUE_PROPERTY || 'Value',
  journalContentProperty: process.env.NOTION_JOURNAL_CONTENT_PROPERTY || 'Content',
  userIdProperty: process.env.NOTION_USER_ID_PROPERTY || 'UserId',
  createdAtProperty: process.env.NOTION_CREATED_AT_PROPERTY || 'CreatedAt'
};
// The SDK's diagnostic logger can include upstream error messages and bodies.
const notion = notionConfig.token ? new NotionClient({
  auth: notionConfig.token,
  logger: () => {}
}) : null;
const NOTION_WRITE_FAILURE = 'Notion delivery failed; remote outcome unknown';

const canSyncToNotion = (type) => {
  if (!notion) return false;
  if (type === 'memory') return Boolean(notionConfig.memoryDatabaseId);
  if (type === 'journal') return Boolean(notionConfig.journalDatabaseId);
  return false;
};

const NOTION_RICH_TEXT_MAX_LENGTH = 2000;

const buildRichTextContentArray = (value) => {
  if (value === undefined || value === null || value === '') {
    return [{ text: { content: '' } }];
  }
  
  const text = String(value);
  if (text.length <= NOTION_RICH_TEXT_MAX_LENGTH) {
    return [{ text: { content: text } }];
  }

  const chunks = [];
  for (let i = 0; i < text.length; i += NOTION_RICH_TEXT_MAX_LENGTH) {
    chunks.push({
      text: { content: text.slice(i, i + NOTION_RICH_TEXT_MAX_LENGTH) }
    });
  }
  return chunks;
};

const setRichTextProperty = (properties, name, value) => {
  if (!name || value === undefined || value === null || value === '') return;
  properties[name] = {
    rich_text: buildRichTextContentArray(value)
  };
};

const setDateProperty = (properties, name, value) => {
  if (!name || !value) return;
  properties[name] = {
    date: { start: value }
  };
};

const buildMemoryNotionProperties = ({ userId, topic, value, createdAt }) => {
  const properties = {
    [notionConfig.titleProperty]: {
      title: [{ text: { content: topic || 'Memory' } }]
    }
  };

  // Only set topic property if it's different from title property to avoid duplication
  if (notionConfig.memoryTopicProperty && 
      notionConfig.titleProperty &&
      notionConfig.memoryTopicProperty !== notionConfig.titleProperty) {
    setRichTextProperty(properties, notionConfig.memoryTopicProperty, topic);
  }
  setRichTextProperty(properties, notionConfig.memoryValueProperty, value);
  setRichTextProperty(properties, notionConfig.userIdProperty, userId);
  setDateProperty(properties, notionConfig.createdAtProperty, createdAt);

  return properties;
};

const buildJournalNotionProperties = ({ userId, title, content, createdAt }) => {
  const properties = {
    [notionConfig.titleProperty]: {
      title: [{ text: { content: title || 'Journal Entry' } }]
    }
  };

  setRichTextProperty(properties, notionConfig.journalContentProperty, content);
  setRichTextProperty(properties, notionConfig.userIdProperty, userId);
  setDateProperty(properties, notionConfig.createdAtProperty, createdAt);

  return properties;
};

const createNotionPage = async ({ databaseId, properties }) => {
  if (!notion) {
    throw new Error('Notion client is not initialized. Please check NOTION_TOKEN configuration.');
  }
  const response = await notion.pages.create({
    parent: { database_id: databaseId },
    properties
  });
  return response.id;
};

const syncEntryToNotion = async (type, payload) => {
  if (!canSyncToNotion(type)) {
    return { synced: false, error: 'Notion not configured' };
  }

  try {
    const databaseId = type === 'memory'
      ? notionConfig.memoryDatabaseId
      : notionConfig.journalDatabaseId;
    const properties = type === 'memory'
      ? buildMemoryNotionProperties(payload)
      : buildJournalNotionProperties(payload);
    const pageId = await createNotionPage({ databaseId, properties });
    return { synced: true, pageId };
  } catch (error) {
    return { synced: false, error: NOTION_WRITE_FAILURE };
  }
};

const { createNotionEntry, sendUnovaEvent } = createBridgeIntegrations();

// GET /memory?userId=123
app.get('/memory', (req, res) => {
  const userId = req.query.userId;
  if (!isValidUserId(userId)) return res.status(400).json({ error: 'Missing userId' });
  const entries = memoryStore[userId] || [];
  res.json(entries);
});

// POST /memory { userId, topic, value }
app.post('/memory', async (req, res) => {
  const { userId, topic, value, syncToNotion } = req.body;
  if (!isValidUserId(userId) || !topic || !value) return res.status(400).json({ error: 'Missing fields' });
  if (!memoryStore[userId]) memoryStore[userId] = [];
  const createdAt = new Date().toISOString();
  memoryStore[userId].push({ topic, value, createdAt });
  
  const response = { success: true };
  if (syncToNotion) {
    try {
      const notionResult = await syncEntryToNotion('memory', { userId, topic, value, createdAt });
      if (!notionResult.synced) {
        console.error('Failed to sync memory entry to Notion:', notionResult.error);
      }
      response.notion = notionResult;
    } catch (error) {
      console.error('Exception while syncing memory entry to Notion:', NOTION_WRITE_FAILURE);
      response.notion = { synced: false, error: NOTION_WRITE_FAILURE };
    }
  }
  res.json(response);
});

// GET /journal?userId=123
app.get('/journal', (req, res) => {
  const userId = req.query.userId;
  if (!isValidUserId(userId)) return res.status(400).json({ error: 'Missing userId' });
  const entries = journalStore[userId] || [];
  res.json(entries);
});

// POST /journal { userId, title, content }
app.post('/journal', async (req, res) => {
  const { userId, title, content, syncToNotion } = req.body;
  if (!isValidUserId(userId) || !title || !content) return res.status(400).json({ error: 'Missing fields' });
  if (!journalStore[userId]) journalStore[userId] = [];
  const createdAt = new Date().toISOString();
  journalStore[userId].push({ title, content, createdAt });
  
  const response = { success: true };
  if (syncToNotion) {
    try {
      const notionResult = await syncEntryToNotion('journal', { userId, title, content, createdAt });
      if (!notionResult.synced) {
        console.error('Failed to sync journal entry to Notion:', notionResult.error);
      }
      response.notion = notionResult;
    } catch (error) {
      console.error('Exception while syncing journal entry to Notion:', NOTION_WRITE_FAILURE);
      response.notion = { synced: false, error: NOTION_WRITE_FAILURE };
    }
  }
  res.json(response);
});

// GET /notion/status - Check Notion config
app.get('/notion/status', (req, res) => {
  const missing = [];
  if (!notionConfig.token) missing.push('NOTION_TOKEN');
  if (!notionConfig.memoryDatabaseId) missing.push('NOTION_MEMORY_DATABASE_ID or NOTION_DATABASE_ID');
  if (!notionConfig.journalDatabaseId) missing.push('NOTION_JOURNAL_DATABASE_ID or NOTION_DATABASE_ID');

  res.json({
    configured: missing.length === 0,
    missing,
    databases: {
      memory: Boolean(notionConfig.memoryDatabaseId),
      journal: Boolean(notionConfig.journalDatabaseId)
    }
  });
});

// POST /notion/memory - Create Notion page for memory entry
app.post('/notion/memory', async (req, res) => {
  const { userId, topic, value, createdAt } = req.body;
  if (!isValidUserId(userId) || !topic || !value) return res.status(400).json({ error: 'Missing fields' });
  if (!canSyncToNotion('memory')) {
    return res.status(503).json({ error: 'Notion not configured' });
  }

  try {
    const timestamp = createdAt || new Date().toISOString();
    const properties = buildMemoryNotionProperties({ userId, topic, value, createdAt: timestamp });
    const pageId = await createNotionPage({ databaseId: notionConfig.memoryDatabaseId, properties });
    res.json({ success: true, pageId });
  } catch (error) {
    res.status(500).json({ error: NOTION_WRITE_FAILURE });
  }
});

// POST /notion/journal - Create Notion page for journal entry
app.post('/notion/journal', async (req, res) => {
  const { userId, title, content, createdAt } = req.body;
  if (!isValidUserId(userId) || !title || !content) return res.status(400).json({ error: 'Missing fields' });
  if (!canSyncToNotion('journal')) {
    return res.status(503).json({ error: 'Notion not configured' });
  }

  try {
    const timestamp = createdAt || new Date().toISOString();
    const properties = buildJournalNotionProperties({ userId, title, content, createdAt: timestamp });
    const pageId = await createNotionPage({ databaseId: notionConfig.journalDatabaseId, properties });
    res.json({ success: true, pageId });
  } catch (error) {
    res.status(500).json({ error: NOTION_WRITE_FAILURE });
  }
});

// GET /openapi.json - Serve schema for Custom GPT actions
app.get('/openapi.json', (req, res) => {
  const serverUrl = publicOrigin || `${req.protocol}://${req.get('host')}`;
  if (stagingBuild) res.set('X-Nova-Staging-Build', stagingBuild);
  res.json(getOpenApiSpec(serverUrl));
});

// Health check
app.get('/', (req, res) => {
  res.send('Nova Memory Server is running');
});

// ============================================
// KEYBOARD CONTROL ENDPOINTS
// ============================================

// POST /control/keyboard/type - Type text string
app.post('/control/keyboard/type', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Peripheral control not available (no display)' });
  }
  
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text field' });
    
    await keyboard.type(text);
    res.json({ success: true, message: `Typed: ${text}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /control/keyboard/key - Press specific key(s)
app.post('/control/keyboard/key', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Peripheral control not available (no display)' });
  }
  
  try {
    const { key, modifiers } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key field' });
    
    // Map string keys to Key enum
    const keyMap = {
      'enter': Key.Enter,
      'escape': Key.Escape,
      'tab': Key.Tab,
      'space': Key.Space,
      'backspace': Key.Backspace,
      'delete': Key.Delete,
      'up': Key.Up,
      'down': Key.Down,
      'left': Key.Left,
      'right': Key.Right,
      'home': Key.Home,
      'end': Key.End,
      'pageup': Key.PageUp,
      'pagedown': Key.PageDown,
      'a': Key.A, 'b': Key.B, 'c': Key.C, 'd': Key.D, 'e': Key.E,
      'f': Key.F, 'g': Key.G, 'h': Key.H, 'i': Key.I, 'j': Key.J,
      'k': Key.K, 'l': Key.L, 'm': Key.M, 'n': Key.N, 'o': Key.O,
      'p': Key.P, 'q': Key.Q, 'r': Key.R, 's': Key.S, 't': Key.T,
      'u': Key.U, 'v': Key.V, 'w': Key.W, 'x': Key.X, 'y': Key.Y,
      'z': Key.Z,
      'leftcontrol': Key.LeftControl,
      'rightcontrol': Key.RightControl,
      'leftshift': Key.LeftShift,
      'rightshift': Key.RightShift,
      'leftalt': Key.LeftAlt,
      'rightalt': Key.RightAlt,
      'leftsuper': Key.LeftSuper,
      'rightsuper': Key.RightSuper,
      'f1': Key.F1, 'f2': Key.F2, 'f3': Key.F3, 'f4': Key.F4,
      'f5': Key.F5, 'f6': Key.F6, 'f7': Key.F7, 'f8': Key.F8,
      'f9': Key.F9, 'f10': Key.F10, 'f11': Key.F11, 'f12': Key.F12,
    };
    
    const nutKey = keyMap[key.toLowerCase()];
    if (!nutKey) {
      return res.status(400).json({ error: `Unknown key: ${key}` });
    }
    
    if (modifiers && Array.isArray(modifiers)) {
      const modKeys = modifiers.map(m => keyMap[m.toLowerCase()]).filter(Boolean);
      await keyboard.pressKey(...modKeys, nutKey);
      await keyboard.releaseKey(...modKeys, nutKey);
    } else {
      await keyboard.pressKey(nutKey);
      await keyboard.releaseKey(nutKey);
    }
    
    res.json({ success: true, message: `Pressed key: ${key}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MOUSE/TRACKPAD CONTROL ENDPOINTS
// ============================================

// POST /control/mouse/move - Move cursor to position
app.post('/control/mouse/move', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Peripheral control not available (no display)' });
  }
  
  try {
    const { x, y, smooth } = req.body;
    if (x === undefined || y === undefined) {
      return res.status(400).json({ error: 'Missing x or y coordinates' });
    }
    
    if (smooth) {
      await mouse.move([{ x, y }]);
    } else {
      await mouse.setPosition({ x, y });
    }
    
    res.json({ success: true, message: `Moved cursor to (${x}, ${y})` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /control/mouse/click - Click mouse button
app.post('/control/mouse/click', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Peripheral control not available (no display)' });
  }
  
  try {
    const { button, double } = req.body || {};
    
    const buttonMap = {
      'left': Button.LEFT,
      'right': Button.RIGHT,
      'middle': Button.MIDDLE,
    };
    
    const mouseButton = buttonMap[button?.toLowerCase()] || Button.LEFT;
    
    if (double) {
      await mouse.doubleClick(mouseButton);
    } else {
      await mouse.click(mouseButton);
    }
    
    res.json({ success: true, message: `Clicked ${button || 'left'} button` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /control/mouse/scroll - Scroll up or down
app.post('/control/mouse/scroll', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Peripheral control not available (no display)' });
  }
  
  try {
    const { amount } = req.body;
    if (amount === undefined) {
      return res.status(400).json({ error: 'Missing amount field' });
    }
    
    // Positive amount scrolls down, negative scrolls up
    if (amount > 0) {
      await mouse.scrollDown(amount);
    } else if (amount < 0) {
      await mouse.scrollUp(Math.abs(amount));
    }
    
    res.json({ success: true, message: `Scrolled ${amount}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /control/mouse/position - Get current mouse position
app.get('/control/mouse/position', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Peripheral control not available (no display)' });
  }
  
  try {
    const position = await mouse.getPosition();
    res.json({ success: true, position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SCREEN CAPTURE ENDPOINTS
// ============================================

// GET /capture/screen - Capture screenshot
app.get('/capture/screen', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Screen capture not available (no display)' });
  }
  
  try {
    const { format } = req.query;
    const requestedFormat = (format || 'png').toLowerCase();
    const allowedFormats = ['png', 'jpg', 'jpeg'];

    if (format && !allowedFormats.includes(requestedFormat)) {
      return res.status(400).json({ error: 'Invalid format. Supported formats are: png, jpg, jpeg.' });
    }

    const captureFormat = requestedFormat === 'jpeg' ? 'jpg' : requestedFormat;
    const contentType = captureFormat === 'jpg' ? 'image/jpeg' : `image/${captureFormat}`;
    const img = await screenshot({ format: captureFormat });
    
    res.set('Content-Type', contentType);
    res.send(img);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /capture/screen/info - Get screen dimensions
app.get('/capture/screen/info', async (req, res) => {
  if (!peripheralControlAvailable) {
    return res.status(503).json({ error: 'Screen capture not available (no display)' });
  }
  
  try {
    const width = await screen.width();
    const height = await screen.height();
    const screenSize = { width, height };
    
    res.json({ success: true, screen: screenSize });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MEDIA UPLOAD ENDPOINTS
// ============================================

// POST /upload/image - Upload camera or screen image
app.post('/upload/image', boundedUpload('image'), (req, res) => {
  try {
    const { userId, description, source } = req.body;
    if (!isValidUserId(userId)) return res.status(400).json({ error: 'Missing userId' });
    if (!req.file) return res.status(400).json({ error: 'Missing image file' });
    const capacity = canAcceptMedia(mediaStore, userId, req.file.size);
    if (!capacity.ok) return res.status(capacity.status).json({ error: capacity.error });
    
    if (!mediaStore[userId]) mediaStore[userId] = [];
    
    const mediaEntry = {
      type: 'image',
      source: source || 'unknown', // 'camera', 'screen', etc.
      description: description || '',
      size: req.file.size,
      mimeType: req.file.mimetype,
      data: req.file.buffer.toString('base64'),
      createdAt: new Date().toISOString()
    };
    
    mediaStore[userId].push(mediaEntry);
    
    res.json({ 
      success: true, 
      message: 'Image uploaded successfully',
      mediaId: mediaStore[userId].length - 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /upload/audio - Upload microphone audio
app.post('/upload/audio', boundedUpload('audio'), (req, res) => {
  try {
    const { userId, description, duration } = req.body;
    if (!isValidUserId(userId)) return res.status(400).json({ error: 'Missing userId' });
    if (!req.file) return res.status(400).json({ error: 'Missing audio file' });
    const capacity = canAcceptMedia(mediaStore, userId, req.file.size);
    if (!capacity.ok) return res.status(capacity.status).json({ error: capacity.error });
    
    if (!mediaStore[userId]) mediaStore[userId] = [];
    
    const mediaEntry = {
      type: 'audio',
      source: 'microphone',
      description: description || '',
      duration: duration || 0,
      size: req.file.size,
      mimeType: req.file.mimetype,
      data: req.file.buffer.toString('base64'),
      createdAt: new Date().toISOString()
    };
    
    mediaStore[userId].push(mediaEntry);
    
    res.json({ 
      success: true, 
      message: 'Audio uploaded successfully',
      mediaId: mediaStore[userId].length - 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /media?userId=123 - Retrieve media for user
app.get('/media', (req, res) => {
  const userId = req.query.userId;
  if (!isValidUserId(userId)) return res.status(400).json({ error: 'Missing userId' });
  
  const entries = mediaStore[userId] || [];
  
  // Return metadata only (without full base64 data for efficiency)
  const metadata = entries.map((entry, index) => ({
    mediaId: index,
    type: entry.type,
    source: entry.source,
    description: entry.description,
    size: entry.size,
    mimeType: entry.mimeType,
    duration: entry.duration,
    createdAt: entry.createdAt
  }));
  
  res.json(metadata);
});

// GET /media/:userId/:mediaId - Retrieve specific media file
app.get('/media/:userId/:mediaId', (req, res) => {
  const { userId, mediaId } = req.params;
  
  const entries = mediaStore[userId];
  if (!entries || !/^(0|[1-9][0-9]*)$/.test(mediaId) || !Object.hasOwn(entries, mediaId)) {
    return res.status(404).json({ error: 'Media not found' });
  }

  const media = entries[mediaId];
  res.json({
    success: true,
    media: {
      type: media.type,
      source: media.source,
      description: media.description,
      size: media.size,
      mimeType: media.mimeType,
      data: media.data,
      createdAt: media.createdAt
    }
  });
});

// ============================================
// BRIDGE ENDPOINTS (UNOVA + NOTION)
// ============================================

// POST /bridge/entry - Store memory/journal and sync to UNOVA/Notion
// Clients may supply a stable Idempotency-Key to suppress network retries.
app.post('/bridge/entry', async (req, res) => {
  try {
    const {
      userId,
      entryType,
      topic,
      value,
      title,
      content,
      tags,
      notion,
      unova
    } = req.body || {};

    if (!isValidUserId(userId) || !entryType) {
      return res.status(400).json({ error: 'Missing userId or entryType' });
    }
    if (entryType === 'memory' && (!topic || !value)) {
      return res.status(400).json({ error: 'Missing topic or value for memory entry' });
    }
    if (entryType === 'journal' && (!title || !content)) {
      return res.status(400).json({ error: 'Missing title or content for journal entry' });
    }
    if (entryType !== 'memory' && entryType !== 'journal') {
      return res.status(400).json({ error: 'Invalid entryType. Use "memory" or "journal".' });
    }

    const result = await bridgeIdempotency.execute({
      key: req.get('Idempotency-Key'),
      userId,
      entryType,
      body: req.body || {}
    }, async () => {
      let storedEntry;
      let notionTitle;
      let notionContent;

      if (entryType === 'memory') {
        if (!memoryStore[userId]) memoryStore[userId] = [];
        storedEntry = { topic, value, createdAt: new Date().toISOString() };
        memoryStore[userId].push(storedEntry);
        notionTitle = title || topic;
        notionContent = value;
      } else {
        if (!journalStore[userId]) journalStore[userId] = [];
        storedEntry = { title, content, createdAt: new Date().toISOString() };
        journalStore[userId].push(storedEntry);
        notionTitle = title;
        notionContent = content;
      }

      const [notionResult, unovaResult] = await Promise.all([
        createNotionEntry({
          title: notionTitle,
          content: notionContent,
          tags,
          userId,
          entryType,
          overrides: notion || {}
        }),
        sendUnovaEvent({
          payload: {
            userId,
            entryType,
            topic,
            value,
            title,
            content,
            tags,
            storedAt: storedEntry.createdAt
          },
          overrides: unova || {}
        })
      ]);

      return {
        success: true,
        stored: { entryType, entry: storedEntry },
        notion: notionResult,
        unova: unovaResult
      };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof BridgeIdempotencyError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// WEBSOCKET FOR REAL-TIME STREAMING
// ============================================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  const stream = createScreenStream({
    capture: ({ format }) => screenshot({ format }),
    emit: (event, payload) => socket.emit(event, payload)
  });

  socket.on('start-screen-stream', (data) => {
    if (!peripheralControlAvailable) {
      socket.emit('stream-error', { error: 'Screen capture not available (no display)' });
      return;
    }
    stream.start(data);
  });

  socket.on('stop-screen-stream', () => stream.stop());

  socket.on('disconnect', () => {
    stream.stop();
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(port, bindHost, () => {
  const address = server.address();
  console.log(`Nova Memory Server listening on ${address.address} port ${address.port}`);
  console.log(`WebSocket server ready for real-time streaming`);
  console.log(`Peripheral control: ${peripheralControlAvailable ? 'enabled' : 'disabled (no display)'}`);
});
