# Nova Memory Server

Simple Express-based backend for storing and retrieving user memory and journal entries for Nova (custom GPT).

## Endpoints

- `GET /memory?userId=...`
- `POST /memory` with `{ userId, topic, value }`
- `GET /journal?userId=...`
- `POST /journal` with `{ userId, title, content }`

This version uses in-memory storage. Swap to a DB like MongoDB or Supabase for persistence.
