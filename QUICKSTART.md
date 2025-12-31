# Quick Start Guide

Get started with Nova Memory Server in 5 minutes!

## Installation

```bash
# Clone the repository
git clone https://github.com/DanDanTheMuffinMan/nova-memory-server.git
cd nova-memory-server

# Install dependencies
npm install

# Start the server
npm start
```

You should see:
```
Nova Memory Server running at http://localhost:3000
WebSocket server ready for real-time streaming
Peripheral control: enabled (or disabled if no display)
```

## Test It Out

### 1. Test Basic Endpoints

```bash
# Store a memory
curl -X POST http://localhost:3000/memory \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","topic":"demo","value":"This works!"}'

# Retrieve memories
curl http://localhost:3000/memory?userId=test

# Store a journal entry
curl -X POST http://localhost:3000/journal \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","title":"First Entry","content":"Hello World!"}'

# Retrieve journal entries
curl http://localhost:3000/journal?userId=test
```

### 2. Test Peripheral Control (requires display)

```bash
# Type text
curl -X POST http://localhost:3000/control/keyboard/type \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from API!"}'

# Move mouse
curl -X POST http://localhost:3000/control/mouse/move \
  -H "Content-Type: application/json" \
  -d '{"x":500,"y":300}'

# Click mouse
curl -X POST http://localhost:3000/control/mouse/click \
  -H "Content-Type: application/json" \
  -d '{"button":"left"}'

# Capture screenshot
curl http://localhost:3000/capture/screen?format=png > screenshot.png
```

### 3. Test WebSocket Streaming

Create a file `test-stream.js`:

```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected! Starting screen stream...');
  socket.emit('start-screen-stream', { fps: 1 });
});

socket.on('screen-frame', (data) => {
  console.log(`Received frame at ${data.timestamp}`);
  console.log(`Image size: ${data.image.length} characters (base64)`);
});

socket.on('stream-error', (error) => {
  console.error('Error:', error);
});

// Stop after 10 seconds
setTimeout(() => {
  socket.emit('stop-screen-stream');
  socket.disconnect();
  process.exit(0);
}, 10000);
```

Run it:
```bash
npm install socket.io-client
node test-stream.js
```

### 4. Upload Media

```bash
# Upload an image
curl -X POST http://localhost:3000/upload/image \
  -F "image=@/path/to/your/image.jpg" \
  -F "userId=test" \
  -F "source=camera" \
  -F "description=Test image"

# List uploaded media
curl http://localhost:3000/media?userId=test
```

## Using with Custom GPT

The server now serves a live OpenAPI schema for action import. With the server running locally (`npm start`):

1) Open the GPT builder → Actions → **Import from URL**  
2) Paste `http://localhost:3000/openapi.json`  
3) (Optional) Paste this message into ChatGPT or VS Code to enable Nova quickly:  
   > Use the Nova Memory Server actions from http://localhost:3000/openapi.json. The server is running locally; it can read/write memory & journal entries, control keyboard/mouse, capture screenshots, and upload media.

Security note: The API can grant an AI full keyboard/mouse control and screen capture. Keep the server bound to localhost, don’t expose port 3000 to untrusted networks, and only connect GPTs/tools you trust.
4. Test the actions!

## Using with AI Agents

See [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for detailed patterns and examples.

### Simple Agent Example

```javascript
const axios = require('axios');
const io = require('socket.io-client');

class SimpleAgent {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.socket = io(this.baseUrl);
  }

  async start() {
    // Monitor screen
    this.socket.on('screen-frame', async (data) => {
      console.log('Analyzing screen...');
      // Send to your AI vision model
      const action = await this.analyzeScreen(data.image);
      await this.executeAction(action);
    });

    this.socket.emit('start-screen-stream', { fps: 2 });
  }

  async analyzeScreen(base64Image) {
    // Your AI logic here
    return { type: 'click', x: 500, y: 300 };
  }

  async executeAction(action) {
    if (action.type === 'click') {
      await axios.post(`${this.baseUrl}/control/mouse/move`, {
        x: action.x,
        y: action.y
      });
      await axios.post(`${this.baseUrl}/control/mouse/click`, {
        button: 'left'
      });
    }
  }
}

const agent = new SimpleAgent();
agent.start();
```

## Troubleshooting

### "Peripheral control not available"
- **Linux:** Install X11: `sudo apt-get install libx11-dev libxtst-dev`
- **macOS:** Grant Accessibility permissions in System Preferences
- **All:** Ensure display server is running (not headless)

### Port Already in Use
```bash
# Change port
PORT=3001 npm start
```

### High CPU Usage
Reduce FPS in screen streaming:
```javascript
socket.emit('start-screen-stream', { fps: 1 }); // Lower FPS
```

## What's Next?

- ✅ Read [README.md](README.md) for complete API documentation
- ✅ Check [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for advanced patterns
- ✅ Review [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for technical details
- ✅ Run `node test-client.js` to see all features in action

## Need Help?

- 📖 Full documentation in README.md
- 🔧 Troubleshooting in INTEGRATION_GUIDE.md
- 💡 Examples in test-client.js
- 🐛 Issues: https://github.com/DanDanTheMuffinMan/nova-memory-server/issues

Enjoy building amazing AI agents! 🚀
