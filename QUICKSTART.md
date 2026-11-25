# Quick Start Guide

Get started with Nova Memory Server in 5 minutes!

## Installation

Set `NOVA_MEMORY_API_KEY` to a dedicated random token of at least 32 UTF-8 bytes in the server environment. Load the same value privately into each trusted client. `UNOVA_API_KEY` belongs to the outbound webhook.

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

With the server running, `node test-client.js` checks authenticated read-only HTTP and Socket.IO admission. Run the following examples only when you intend to create test data or exercise the indicated peripheral.

In the client shell, define this helper to pass the bearer header through standard input.

```bash
nova_curl() {
  printf 'Authorization: Bearer %s\n' "${NOVA_MEMORY_API_KEY:?set the client credential}" | curl --header @- "$@"
}
```

### 1. Test Basic Endpoints

```bash
# Store a memory
nova_curl -X POST http://localhost:3000/memory \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","topic":"demo","value":"This works!"}'

# Retrieve memories
nova_curl "http://localhost:3000/memory?userId=test"

# Store a journal entry
nova_curl -X POST http://localhost:3000/journal \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","title":"First Entry","content":"Hello World!"}'

# Retrieve journal entries
nova_curl "http://localhost:3000/journal?userId=test"
```

### 2. Test Peripheral Control (requires display)

```bash
# Type text
nova_curl -X POST http://localhost:3000/control/keyboard/type \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from API!"}'

# Move mouse
nova_curl -X POST http://localhost:3000/control/mouse/move \
  -H "Content-Type: application/json" \
  -d '{"x":500,"y":300}'

# Click mouse
nova_curl -X POST http://localhost:3000/control/mouse/click \
  -H "Content-Type: application/json" \
  -d '{"button":"left"}'

# Capture screenshot
nova_curl "http://localhost:3000/capture/screen?format=png" > screenshot.png
```

### 3. Test WebSocket Streaming

Create a file `test-stream.js`:

```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3000', { auth: { token: process.env.NOVA_MEMORY_API_KEY } });

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
nova_curl -X POST http://localhost:3000/upload/image \
  -F "image=@/path/to/your/image.jpg" \
  -F "userId=test" \
  -F "source=camera" \
  -F "description=Test image"

# List uploaded media
nova_curl "http://localhost:3000/media?userId=test"
```

## Using with Custom GPT

**⚠️ Important:** Custom GPTs run on OpenAI's servers and cannot access `http://localhost:3000` directly!

**For complete setup instructions, see [CUSTOM_GPT_SETUP.md](CUSTOM_GPT_SETUP.md)**

Quick options:

### Option 1: Use a Tunnel Service (Easiest)
```bash
# Terminal 1
npm start

# Terminal 2
ngrok http 3000  # or cloudflared tunnel --url http://localhost:3000
```
Then import from your tunnel URL: `https://YOUR-TUNNEL-URL/openapi.json`

### Option 2: Export and Paste Schema
```bash
node export-openapi.js https://your-verified-tunnel.example
# Replace the example URL with your actual HTTPS origin, then copy contents of openapi.json and paste into Custom GPT Actions
```

In the Action’s authentication settings choose **API Key → Bearer** and enter the server’s `NOVA_MEMORY_API_KEY` in the credential field. Keep the key out of the schema, instructions, and chat. Verify that `servers[0].url` is the HTTPS origin you control before testing.

### Security Note
The API can grant an AI full keyboard/mouse control and screen capture. Only use with tunnel services you trust, keep logs monitored, and understand the risks. See [CUSTOM_GPT_SETUP.md](CUSTOM_GPT_SETUP.md) for detailed security guidelines.

## Using with AI Agents

See [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for detailed patterns and examples.

### Simple Agent Example

```javascript
const nova = require('axios').create({
  headers: { Authorization: `Bearer ${process.env.NOVA_MEMORY_API_KEY}` },
  maxRedirects: 0
});
const io = require('socket.io-client');

class SimpleAgent {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.socket = io(this.baseUrl, { auth: { token: process.env.NOVA_MEMORY_API_KEY } });
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
      await nova.post(`${this.baseUrl}/control/mouse/move`, {
        x: action.x,
        y: action.y
      });
      await nova.post(`${this.baseUrl}/control/mouse/click`, {
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
- ✅ Run `node test-client.js` to verify authenticated HTTP and Socket.IO admission

## Need Help?

- 📖 Full documentation in README.md
- 🔧 Troubleshooting in INTEGRATION_GUIDE.md
- 💡 Examples in test-client.js
- 🐛 Issues: https://github.com/DanDanTheMuffinMan/nova-memory-server/issues

Enjoy building amazing AI agents! 🚀
