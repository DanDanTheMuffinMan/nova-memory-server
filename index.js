const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());

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
const memoryStore = {};
const journalStore = {};
const mediaStore = {}; // Store uploaded media references

// GET /memory?userId=123
app.get('/memory', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const entries = memoryStore[userId] || [];
  res.json(entries);
});

// POST /memory { userId, topic, value }
app.post('/memory', (req, res) => {
  const { userId, topic, value } = req.body;
  if (!userId || !topic || !value) return res.status(400).json({ error: 'Missing fields' });
  if (!memoryStore[userId]) memoryStore[userId] = [];
  memoryStore[userId].push({ topic, value, createdAt: new Date().toISOString() });
  res.json({ success: true });
});

// GET /journal?userId=123
app.get('/journal', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const entries = journalStore[userId] || [];
  res.json(entries);
});

// POST /journal { userId, title, content }
app.post('/journal', (req, res) => {
  const { userId, title, content } = req.body;
  if (!userId || !title || !content) return res.status(400).json({ error: 'Missing fields' });
  if (!journalStore[userId]) journalStore[userId] = [];
  journalStore[userId].push({ title, content, createdAt: new Date().toISOString() });
  res.json({ success: true });
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
    const { button, double } = req.body;
    
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
    const img = await screenshot({ format: format || 'png' });
    
    res.set('Content-Type', `image/${format || 'png'}`);
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
app.post('/upload/image', upload.single('image'), (req, res) => {
  try {
    const { userId, description, source } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (!req.file) return res.status(400).json({ error: 'Missing image file' });
    
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
app.post('/upload/audio', upload.single('audio'), (req, res) => {
  try {
    const { userId, description, duration } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (!req.file) return res.status(400).json({ error: 'Missing audio file' });
    
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
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  
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
  
  if (!mediaStore[userId] || !mediaStore[userId][mediaId]) {
    return res.status(404).json({ error: 'Media not found' });
  }
  
  const media = mediaStore[userId][mediaId];
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
// WEBSOCKET FOR REAL-TIME STREAMING
// ============================================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  let streamingInterval = null;
  
  // Start screen streaming
  socket.on('start-screen-stream', async (data) => {
    if (!peripheralControlAvailable) {
      socket.emit('stream-error', { error: 'Screen capture not available (no display)' });
      return;
    }
    
    const { fps = 1 } = data;
    const interval = Math.floor(1000 / fps);
    
    console.log(`Starting screen stream for ${socket.id} at ${fps} fps`);
    
    streamingInterval = setInterval(async () => {
      try {
        const img = await screenshot({ format: 'jpg' });
        socket.emit('screen-frame', {
          image: img.toString('base64'),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Screen capture error:', error);
        socket.emit('stream-error', { error: error.message });
      }
    }, interval);
  });
  
  // Stop screen streaming
  socket.on('stop-screen-stream', () => {
    if (streamingInterval) {
      clearInterval(streamingInterval);
      streamingInterval = null;
      console.log(`Stopped screen stream for ${socket.id}`);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    if (streamingInterval) {
      clearInterval(streamingInterval);
    }
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(port, () => {
  console.log(`Nova Memory Server running at http://localhost:${port}`);
  console.log(`WebSocket server ready for real-time streaming`);
  console.log(`Peripheral control: ${peripheralControlAvailable ? 'enabled' : 'disabled (no display)'}`);
});
