# Nova Memory Server - Integration Guide for Custom GPTs and AI Agents

This guide explains how to integrate Nova Memory Server's peripheral control and media capture capabilities with your Custom GPT, AI agent, or automation workflow.

## Quick Start

Set `NOVA_MEMORY_API_KEY` to a dedicated random token of at least 32 UTF-8 bytes in the server environment. Load the same value privately into each trusted client. `UNOVA_API_KEY` belongs to the outbound webhook. The Node.js examples below run in a trusted process with that environment and use an operator-configured server URL. Keep this privileged credential out of browser bundles.

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **The server will indicate its capabilities:**
   ```
   Nova Memory Server running at http://localhost:3000
   WebSocket server ready for real-time streaming
   Peripheral control: enabled/disabled (no display)
   ```

## System Requirements

### For Full Functionality (Peripheral Control + Screen Capture)
- **Operating System:** Windows, macOS, or Linux with X11
- **Display:** A display server must be running (not headless)
- **Permissions:** 
  - macOS: Accessibility permissions may be required
  - Linux: X11 display server access
  - Windows: Usually works out of the box

### For Basic Functionality (Memory/Journal/Media Upload only)
- Any operating system
- Can run in headless/server environments

## Integration Patterns

### Pattern 1: Custom GPT with Actions

Import the live `/openapi.json` from your HTTPS origin, or run `node export-openapi.js https://your-verified-tunnel.example` with that origin and paste the resulting JSON. In the Action’s authentication settings choose **API Key → Bearer** and enter the server’s `NOVA_MEMORY_API_KEY` in the credential field. Keep the key out of the schema, instructions, and chat. Verify that `servers[0].url` is the HTTPS origin you control before testing.

### Pattern 2: AI Agent with Screen Monitoring

```javascript
const io = require('socket.io-client');
const nova = require('axios').create({
  headers: { Authorization: `Bearer ${process.env.NOVA_MEMORY_API_KEY}` },
  maxRedirects: 0
});

class AIAgent {
  constructor(serverUrl = 'http://localhost:3000') {
    this.serverUrl = serverUrl;
    this.socket = io(serverUrl, { auth: { token: process.env.NOVA_MEMORY_API_KEY } });
    this.setupScreenMonitoring();
  }

  setupScreenMonitoring() {
    this.socket.on('connect', () => {
      console.log('Connected to Nova Memory Server');
      // Start screen monitoring at 2 FPS
      this.socket.emit('start-screen-stream', { fps: 2 });
    });

    this.socket.on('screen-frame', async (data) => {
      console.log('Received screen frame:', data.timestamp);
      
      // Send screen to AI for analysis
      const analysis = await this.analyzeScreen(data.image);
      
      // Take action based on analysis
      if (analysis.needsAction) {
        await this.performAction(analysis.action);
      }
    });

    this.socket.on('stream-error', (error) => {
      console.error('Stream error:', error);
    });
  }

  async analyzeScreen(base64Image) {
    // Send to your AI vision model
    // e.g., OpenAI GPT-4 Vision, Claude with vision, etc.
    return { needsAction: false };
  }

  async performAction(action) {
    switch(action.type) {
      case 'click':
        await nova.post(`${this.serverUrl}/control/mouse/click`, {
          button: 'left'
        });
        break;
      case 'type':
        await nova.post(`${this.serverUrl}/control/keyboard/type`, {
          text: action.text
        });
        break;
    }
  }

  stop() {
    this.socket.emit('stop-screen-stream');
    this.socket.disconnect();
  }
}

// Usage
const agent = new AIAgent();
```

### Pattern 3: Recording User Session

```javascript
const nova = require('axios').create({
  headers: { Authorization: `Bearer ${process.env.NOVA_MEMORY_API_KEY}` },
  maxRedirects: 0
});
const io = require('socket.io-client');
const fs = require('fs');

class SessionRecorder {
  constructor(userId, serverUrl = 'http://localhost:3000') {
    this.userId = userId;
    this.serverUrl = serverUrl;
    this.socket = io(serverUrl, { auth: { token: process.env.NOVA_MEMORY_API_KEY } });
    this.frames = [];
  }

  async startRecording(fps = 1) {
    return new Promise((resolve) => {
      this.socket.on('connect', () => {
        console.log('Recording started');
        this.socket.emit('start-screen-stream', { fps });
      });

      this.socket.on('screen-frame', async (data) => {
        this.frames.push(data);
        
        // Upload to server every 10 frames
        if (this.frames.length >= 10) {
          await this.uploadFrames();
        }
      });

      resolve();
    });
  }

  async uploadFrames() {
    const FormData = require('form-data');
    
    for (const frame of this.frames) {
      const formData = new FormData();
      const buffer = Buffer.from(frame.image, 'base64');
      formData.append('image', buffer, 'screen.jpg');
      formData.append('userId', this.userId);
      formData.append('source', 'screen');
      formData.append('description', `Screen capture at ${frame.timestamp}`);

      await nova.post(`${this.serverUrl}/upload/image`, formData, {
        headers: formData.getHeaders()
      });
    }

    console.log(`Uploaded ${this.frames.length} frames`);
    this.frames = [];
  }

  stopRecording() {
    this.socket.emit('stop-screen-stream');
    this.socket.disconnect();
  }
}

// Usage
const recorder = new SessionRecorder('user123');
await recorder.startRecording(2); // 2 FPS

// Stop after 30 seconds
setTimeout(() => {
  recorder.stopRecording();
}, 30000);
```

### Pattern 4: Voice + Screen Agent

```javascript
const nova = require('axios').create({
  headers: { Authorization: `Bearer ${process.env.NOVA_MEMORY_API_KEY}` },
  maxRedirects: 0
});
const FormData = require('form-data');

class VoiceScreenAgent {
  constructor(userId, serverUrl = 'http://localhost:3000') {
    this.userId = userId;
    this.serverUrl = serverUrl;
  }

  async captureAndUploadScreen() {
    // Capture screenshot
    const response = await nova.get(`${this.serverUrl}/capture/screen?format=jpg`, {
      responseType: 'arraybuffer'
    });

    // Upload to thread
    const formData = new FormData();
    formData.append('image', Buffer.from(response.data), 'screen.jpg');
    formData.append('userId', this.userId);
    formData.append('source', 'screen');
    formData.append('description', 'Current screen state');

    await nova.post(`${this.serverUrl}/upload/image`, formData, {
      headers: formData.getHeaders()
    });

    return 'Screen captured and uploaded';
  }

  async uploadAudio(audioBuffer, duration) {
    const formData = new FormData();
    formData.append('audio', audioBuffer, 'voice.webm');
    formData.append('userId', this.userId);
    formData.append('duration', duration.toString());
    formData.append('description', 'Voice command');

    const response = await nova.post(`${this.serverUrl}/upload/audio`, formData, {
      headers: formData.getHeaders()
    });

    return response.data.mediaId;
  }

  async controlMouse(x, y, click = false) {
    await nova.post(`${this.serverUrl}/control/mouse/move`, {
      x, y, smooth: true
    });

    if (click) {
      await nova.post(`${this.serverUrl}/control/mouse/click`, {
        button: 'left'
      });
    }
  }

  async typeText(text) {
    await nova.post(`${this.serverUrl}/control/keyboard/type`, {
      text
    });
  }

  async pressKey(key, modifiers = []) {
    await nova.post(`${this.serverUrl}/control/keyboard/key`, {
      key,
      modifiers
    });
  }
}

// Usage
const agent = new VoiceScreenAgent('user123');

// Capture screen for AI to see
await agent.captureAndUploadScreen();

// AI decides to click at coordinates
await agent.controlMouse(500, 300, true);

// AI decides to type
await agent.typeText('Hello from AI!');

// AI decides to press Enter
await agent.pressKey('enter');
```

### Pattern 5: Sync Memory & Journal to Notion and UNOVA

Use the bridge endpoint to store memory/journal entries and push them into Notion or UNOVA.

```javascript
const nova = require('axios').create({
  headers: { Authorization: `Bearer ${process.env.NOVA_MEMORY_API_KEY}` },
  maxRedirects: 0
});

async function syncMemoryToNotion(serverUrl, entry) {
  try {
    const response = await nova.post(`${serverUrl}/notion/memory`, {
      userId: entry.userId,
      topic: entry.topic,
      value: entry.value,
      createdAt: entry.createdAt
    });

    return response.data.pageId;
  } catch (error) {
    throw new Error('Failed to sync memory entry to Notion: ' + (error.response?.status ?? 'connection error'));
  }
}

async function syncJournalToNotion(serverUrl, entry) {
  try {
    const response = await nova.post(`${serverUrl}/notion/journal`, {
      userId: entry.userId,
      title: entry.title,
      content: entry.content,
      createdAt: entry.createdAt
    });

    return response.data.pageId;
  } catch (error) {
    throw new Error('Failed to sync journal entry to Notion: ' + (error.response?.status ?? 'connection error'));
  }
}
```

To auto-sync when storing memory/journal entries, set `syncToNotion: true` in the request body.

```javascript
const nova = require('axios').create({
  headers: { Authorization: `Bearer ${process.env.NOVA_MEMORY_API_KEY}` },
  maxRedirects: 0
});
const serverUrl = 'http://localhost:3000';

await nova.post(`${serverUrl}/bridge/entry`, {
  userId: 'user123',
  entryType: 'memory',
  topic: 'Preferred stack',
  value: 'Next.js + Node.js',
  tags: ['tech', 'stack']
});

await nova.post(`${serverUrl}/bridge/entry`, {
  userId: 'user123',
  entryType: 'journal',
  title: 'UNOVA sync',
  content: 'Pushed today’s summary to Notion and UNOVA.',
  tags: ['daily', 'sync']
});
```

## Security Considerations

⚠️ **IMPORTANT:** This server provides powerful control over your computer. Use with caution:

1. **Network Security:**
   - Set `NOVA_MEMORY_HOST=127.0.0.1` for a loopback-only listener
   - Use firewall rules to restrict access
   - Authenticate protected requests and Socket.IO connections in every environment

2. **Input Validation:**
   - All endpoints validate inputs
   - Rate limiting recommended for production

3. **Display Access:**
   - Peripheral control requires appropriate system permissions
   - Ensure your AI agent has proper authorization

## Troubleshooting

### "Peripheral control not available (no display)"
- **Cause:** No display server detected
- **Solution:** Ensure X11 (Linux) or display server is running
- **Note:** Media upload and memory endpoints still work

### Segmentation Fault on Linux
- **Cause:** Missing X11 libraries
- **Solution:** Install required packages:
  ```bash
  sudo apt-get install libx11-dev libxtst-dev libpng-dev
  ```

### Permission Denied (macOS)
- **Cause:** Accessibility permissions not granted
- **Solution:** System Preferences → Security & Privacy → Accessibility → Add your terminal/app

### High CPU Usage During Screen Streaming
- **Cause:** FPS too high
- **Solution:** Reduce FPS to 1-2 for most use cases
  ```javascript
  socket.emit('start-screen-stream', { fps: 1 });
  ```

## Advanced Usage

Use the authenticated `nova` HTTP client defined in the integration examples above.

### Custom Key Combinations

```javascript
// Ctrl+Shift+T (open new terminal tab)
await nova.post('http://localhost:3000/control/keyboard/key', {
  key: 't',
  modifiers: ['leftcontrol', 'leftshift']
});

// Cmd+Space (macOS Spotlight)
await nova.post('http://localhost:3000/control/keyboard/key', {
  key: 'space',
  modifiers: ['leftsuper']
});
```

### Mouse Automation

```javascript
// Get current position
const pos = await nova.get('http://localhost:3000/control/mouse/position');
console.log('Mouse at:', pos.data.position);

// Smooth movement
await nova.post('http://localhost:3000/control/mouse/move', {
  x: 800,
  y: 600,
  smooth: true
});

// Double click
await nova.post('http://localhost:3000/control/mouse/click', {
  button: 'left',
  double: true
});

// Right click
await nova.post('http://localhost:3000/control/mouse/click', {
  button: 'right'
});

// Scroll
await nova.post('http://localhost:3000/control/mouse/scroll', {
  amount: 5
});
```

## API Reference

See [README.md](README.md) for complete API documentation.

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT
