# Nova Memory Server

Express-based backend for storing and retrieving user memory, journal entries, and providing computer peripheral control and media capture capabilities for Nova (custom GPT) and AI agents.

## Core Features

### Memory & Journal Storage
- `GET /memory?userId=...` - Retrieve memory entries
- `POST /memory` with `{ userId, topic, value }` - Store memory entry
- `GET /journal?userId=...` - Retrieve journal entries
- `POST /journal` with `{ userId, title, content }` - Store journal entry

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
