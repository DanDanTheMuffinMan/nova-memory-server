const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory data store
const memoryStore = {};
const journalStore = {};

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

app.listen(port, () => {
  console.log(`Nova Memory Server running at http://localhost:${port}`);
});
