# Nova Memory Server

Express-based backend for storing and retrieving user memory, journal entries, and providing computer peripheral control and media capture capabilities for Nova (custom GPT) and AI agents.

## 🚀 Quick Start with Custom GPT

Want to give your ChatGPT the ability to control your computer, capture screenshots, and remember things? 

**See [CUSTOM_GPT_SETUP.md](CUSTOM_GPT_SETUP.md) for complete setup instructions!**

### 📋 Copy-paste message for Codex/ChatGPT
Give the following message to your coding agent (Codex/ChatGPT) so it follows the README steps precisely:

```
You are my setup agent for the nova-memory-server project. Execute every step exactly as written in README.md:
1) Run `npm install` in the repository root.
2) Start the server with `npm start`.
3) If external access is needed, open an HTTPS tunnel to port 3000 (e.g., `ngrok http 3000`) and capture the HTTPS base URL as {BASE_URL}.
4) In ChatGPT GPT Builder → Actions, import the OpenAPI schema from {BASE_URL}/openapi.json. If a tunnel is available, you may also run `node export-openapi.js {BASE_URL}` to embed that URL; if no tunnel exists yet, run `node export-openapi.js`, then set `servers[0].url` in the exported JSON to your HTTPS tunnel before importing.
5) Ask me for any missing values (e.g., {BASE_URL}, NOTION/UNOVA environment variables) instead of inventing them.
6) Confirm completion by reporting the server status and the base URL used, then provide a short example prompt (e.g., “Store this in memory: my Wi-Fi is NovaNet”).
```

Quick overview:
1. `npm install && npm start` - Start the server
2. `ngrok http 3000` - Expose to the internet (or use the export script)
3. Import the OpenAPI schema into your Custom GPT Actions
4. Start chatting with an AI that can see and control your computer!

### 🔌 Reconnect your Nova Custom GPT (quick steps)
1. Start the server: `npm start`
2. Open a tunnel: `ngrok http 3000` (or any HTTPS tunnel) and copy the HTTPS URL
3. In GPT Builder → Actions → **Import from URL**, paste your ngrok HTTPS URL with `/openapi.json` appended (for example, `https://abc123.ngrok-free.app/openapi.json`), then click **Import**
4. Save the GPT and try a prompt like 'Store this in memory: my Wi-Fi is NovaNet'

- **No tunnel?** Run `node export-openapi.js` to export the schema. Before pasting `openapi.json` into the Actions schema editor, update the `servers[0].url` to a reachable HTTPS URL (e.g., your tunnel). If you already have a tunnel, you can instead run `node export-openapi.js https://abc123.ngrok-free.app` and paste that JSON directly.

## Core Features

### Memory & Journal Storage
- `GET /memory?userId=...` - Retrieve memory entries
- `POST /memory` with `{ userId, topic, value }` - Store memory entry
- `GET /journal?userId=...` - Retrieve journal entries
- `POST /journal` with `{ userId, title, content }` - Store journal entry

### Notion Bridge
- `GET /notion/status` - Check Notion configuration
- `POST /notion/memory` with `{ userId, topic, value }` - Create a Notion page for a memory entry
- `POST /notion/journal` with `{ userId, title, content }` - Create a Notion page for a journal entry
- Optional `syncToNotion: true` on `/memory` and `/journal` to sync entries automatically

### Keyboard Control
- `POST /control/keyboard/type` with `{ text }` - Type text string
- `POST /control/keyboard/key` with `{ key, modifiers }` - Press specific key(s)
  - Supported keys: enter, escape, tab, space, backspace, delete, arrow keys, function keys, letters, modifiers (shift, control, alt, super)
  - Example: `{ "key": "c", "modifiers": ["leftcontrol"] }` for Ctrl+C

### Mouse/Trackpad Control
- `POST /control/mouse/move` with `{ x, y, smooth }` - Move cursor to position
- `POST /control/mouse/click` with `{ button, double }` - Click mouse button (left, right, middle)
- `POST /control/mouse/scroll` with `{ amount }` - Scroll up or down
- `GET /control/mouse/position` - Get current mouse position

### Screen Capture
- `GET /capture/screen?format=png` - Capture screenshot (png or jpg)
- `GET /capture/screen/info` - Get screen dimensions

### Media Upload & Storage
- `POST /upload/image` with multipart form data - Upload camera/screen images
  - Fields: `image` (file), `userId`, `description`, `source` (camera/screen)
- `POST /upload/audio` with multipart form data - Upload microphone audio
  - Fields: `audio` (file), `userId`, `description`, `duration`
- `GET /media?userId=...` - List media metadata for user
- `GET /media/:userId/:mediaId` - Retrieve specific media file with base64 data

### UNOVA + Notion Bridge
- `POST /bridge/entry` with `{ userId, entryType, ... }` - Store a memory/journal entry and sync to UNOVA + Notion
  - Memory payload: `{ entryType: "memory", topic, value }`
  - Journal payload: `{ entryType: "journal", title, content }`
  - Optional: `tags`, `notion` overrides, `unova` overrides

### Real-Time Streaming (WebSocket)
Connect to WebSocket server at `ws://localhost:3000`

**Events:**
- `start-screen-stream` with `{ fps }` - Start streaming screen at specified FPS
- `stop-screen-stream` - Stop screen streaming
- `screen-frame` event receives `{ image: base64, timestamp }` - Screen frame data
- `stream-error` event receives `{ error }` - Stream error notifications

### OpenAPI Schema for Custom GPTs
- GET `/openapi.json` - Live schema you can import directly in ChatGPT/VS Code actions

## Installation

```bash
npm install
npm start
```

## UNOVA + Notion Configuration

Set environment variables to enable sync:

```bash
# Notion
NOTION_TOKEN=secret_xxx
NOTION_DATABASE_ID=xxxxxxxxxxxx
NOTION_TITLE_PROPERTY=Name
# Optional property mappings
NOTION_TAGS_PROPERTY=Tags
NOTION_USER_PROPERTY=User
NOTION_ENTRY_TYPE_PROPERTY=Entry Type

# UNOVA
UNOVA_WEBHOOK_URL=https://your-unova-endpoint.example.com/hooks
UNOVA_API_KEY=your_api_key
UNOVA_EVENT_NAME=nova.entry.created
```

## Usage Examples

### Keyboard Control
```javascript
// Type text
fetch('http://localhost:3000/control/keyboard/type', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Hello, World!' })
});

// Press Ctrl+C
fetch('http://localhost:3000/control/keyboard/key', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'c', modifiers: ['leftcontrol'] })
});
```

### Mouse Control
```javascript
// Move cursor
fetch('http://localhost:3000/control/mouse/move', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x: 100, y: 200, smooth: true })
});

// Click
fetch('http://localhost:3000/control/mouse/click', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ button: 'left', double: false })
});
```

### Screen Capture
```javascript
// Get screenshot
const response = await fetch('http://localhost:3000/capture/screen?format=png');
const imageBlob = await response.blob();
```

### WebSocket Streaming
```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  // Start streaming at 2 FPS
  socket.emit('start-screen-stream', { fps: 2 });
});

socket.on('screen-frame', (data) => {
  console.log('Received frame at:', data.timestamp);
  // data.image contains base64 encoded image
});

// Stop streaming
socket.emit('stop-screen-stream');
```

### Media Upload
```javascript
// Upload image from camera
const formData = new FormData();
formData.append('image', imageFile);
formData.append('userId', 'user123');
formData.append('source', 'camera');
formData.append('description', 'Profile picture');

fetch('http://localhost:3000/upload/image', {
  method: 'POST',
  body: formData
});
```

## Notes

- This version uses in-memory storage. For persistence, integrate a database like MongoDB or Supabase.
- Keyboard and mouse control requires appropriate system permissions.
- Screen capture may require additional permissions on some operating systems.
- WebSocket streaming can be resource-intensive; adjust FPS based on your needs.

## Notion Configuration

Set these environment variables to enable the Notion bridge:

- `NOTION_TOKEN` - Notion integration token
- `NOTION_MEMORY_DATABASE_ID` - Database ID for memory entries (or `NOTION_DATABASE_ID` for a shared database)
- `NOTION_JOURNAL_DATABASE_ID` - Database ID for journal entries (or `NOTION_DATABASE_ID` for a shared database)

Optional property overrides (defaults shown):

- `NOTION_TITLE_PROPERTY` (`Name`)
- `NOTION_MEMORY_TOPIC_PROPERTY` (`Topic`)
- `NOTION_MEMORY_VALUE_PROPERTY` (`Value`)
- `NOTION_JOURNAL_CONTENT_PROPERTY` (`Content`)
- `NOTION_USER_ID_PROPERTY` (`UserId`)
- `NOTION_CREATED_AT_PROPERTY` (`CreatedAt`)
