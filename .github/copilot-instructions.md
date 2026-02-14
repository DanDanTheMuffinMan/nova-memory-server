# Copilot Instructions for Nova Memory Server

## Project Overview
Nova Memory Server is an Express-based backend that provides memory storage, journal entries, and computer peripheral control capabilities for Nova (custom GPT) and AI agents. It enables AI agents to interact with computer peripherals (keyboard, mouse) and capture media (screen, camera, microphone) in real-time.

**Target Users:** Custom GPT creators, AI agent developers, and automation enthusiasts  
**Purpose:** Bridge between AI agents and computer control, enabling AI to see and interact with user's computer

## Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js 4.18.2
- **WebSocket:** Socket.IO 4.8.3 for real-time streaming
- **Storage:** In-memory JavaScript objects (no database)
- **Peripheral Control:** @nut-tree-fork/nut-js 4.2.6 (keyboard/mouse)
- **Screen Capture:** screenshot-desktop 1.15.3
- **File Upload:** multer 2.0.2 with memory storage
- **External Integrations:** 
  - Notion API (@notionhq/client 2.2.15) for note syncing
  - UNOVA webhook support for event streaming

## Project Structure
```
/
├── index.js                    # Main server with all endpoints (1700+ lines)
├── export-openapi.js           # OpenAPI schema generator
├── test-client.js              # Test suite demonstrating all features
├── package.json                # Dependencies and scripts
├── README.md                   # User-facing API documentation
├── INTEGRATION_GUIDE.md        # Integration patterns for Custom GPTs
├── IMPLEMENTATION_SUMMARY.md   # Technical implementation details
├── CUSTOM_GPT_SETUP.md        # Setup guide for Custom GPT integration
├── EXAMPLE_GPT_CONFIG.md      # Example GPT configuration
└── QUICKSTART.md              # Quick start guide
```

## Development Setup
1. Install dependencies: `npm install`
2. Start the server: `npm start` (runs on port 3000 by default)
3. Server runs on port 3000 by default (configurable via `PORT` environment variable)
4. Test functionality: `node test-client.js` (requires server to be running)
5. Export OpenAPI schema: `npm run export-schema [base-url]`

**No build step required** - this is a pure Node.js application without TypeScript or bundling.

## Code Conventions

### Environment Variables & Configuration
The server supports these optional environment variables:
- `PORT` - Server port (default: 3000)
- `NOTION_TOKEN` - Notion integration token for syncing
- `NOTION_DATABASE_ID` - Default Notion database ID
- `NOTION_MEMORY_DATABASE_ID` - Specific database for memory entries
- `NOTION_JOURNAL_DATABASE_ID` - Specific database for journal entries
- `NOTION_*_PROPERTY` - Property name overrides (Title, Topic, Value, Content, etc.)
- `UNOVA_WEBHOOK_URL` - UNOVA webhook endpoint
- `UNOVA_API_KEY` - UNOVA authentication
- `UNOVA_EVENT_NAME` - Event name for UNOVA notifications

All configuration is optional - the server works without environment variables for basic functionality.

### API Design
- All endpoints return JSON responses
- Success responses include `{ success: true }` or data objects
- Error responses include `{ error: "description" }` with appropriate HTTP status codes:
  - 400: Missing required fields or bad request
  - 503: Service unavailable (e.g., peripheral control not available in headless mode)
  - 500: Internal server error
- Use OpenAPI schema format for documenting endpoints (see `getOpenApiSpec` function)

### Error Handling
- Use try-catch blocks for all operations that might fail
- Return appropriate HTTP status codes and descriptive error messages
- For peripheral control endpoints, check `peripheralControlAvailable` flag and return 503 if not available
- WebSocket errors should emit `stream-error` events with error details

### Code Style
- Use `const` for all variable declarations unless reassignment is needed
- Use arrow functions for callbacks and inline functions
- Use template literals for string interpolation
- Keep endpoint handlers concise; extract complex logic into separate functions if needed
- Add descriptive comments for complex operations or business logic

### Peripheral Control
- All peripheral control features (keyboard, mouse, screen capture) must gracefully degrade in headless environments
- Check `peripheralControlAvailable` flag before using any peripheral control libraries
- Detection logic: Check for DISPLAY environment variable (Linux) or assume available on Windows/macOS
- Return HTTP 503 with clear error messages when features are unavailable

### WebSocket Patterns
- Use Socket.IO for real-time communication
- Screen streaming controlled via `start-screen-stream` and `stop-screen-stream` events
- Emit `screen-frame` events with `{ image: base64, timestamp }` data
- Handle cleanup properly when clients disconnect (clear intervals, remove listeners)
- Validate FPS parameter (1-60) for screen streaming

### Data Storage
- Use simple JavaScript objects for in-memory storage
- Structure: `store[userId] = [array of entries]` or `store[userId][entryId] = entry`
- Add timestamps to all entries using `Date.now()`
- For media storage, store metadata separately and include base64 data in retrieval endpoints

## Testing Approach
- **No formal test framework** (Jest, Mocha, etc.) - uses manual testing via test client
- Test client in `test-client.js` demonstrates all functionality
- Run tests: `node test-client.js` (requires server running on localhost:3000)
- Test both success and error cases
- For peripheral control, test both with and without display availability
- For WebSocket streaming, test connection, start/stop streaming, and error scenarios
- When adding features, update `test-client.js` with new test functions

## Security Considerations
- CORS is enabled for all origins (development default) - should be restricted in production
- No authentication/authorization implemented - server should run on localhost only
- Peripheral control endpoints provide powerful system access - ensure proper access controls
- Input validation required on all endpoints to prevent injection attacks
- Media uploads are limited to memory storage - consider size limits for production use

## Important Files
- `index.js` - Main server file with all endpoints and logic
- `package.json` - Dependencies and project metadata
- `README.md` - User-facing API documentation with usage examples
- `INTEGRATION_GUIDE.md` - Detailed integration guide for Custom GPTs and AI agents
- `IMPLEMENTATION_SUMMARY.md` - Technical implementation details
- `test-client.js` - Comprehensive test suite and examples

## Common Tasks

### Adding a New Endpoint
1. Add route handler in `index.js` with appropriate error handling
2. Update the OpenAPI schema in `getOpenApiSpec` function
3. Update `README.md` with endpoint documentation and usage example
4. Add test case in `test-client.js` if applicable

### Modifying Peripheral Control
1. Check if changes work in both display and headless modes
2. Update error handling for 503 responses
3. Test on multiple platforms if possible (Windows, macOS, Linux)
4. Update documentation in README.md and INTEGRATION_GUIDE.md

### Adding Media Types
1. Add new upload endpoint with multer middleware
2. Store metadata in appropriate store (similar to imageStore/audioStore pattern)
3. Add retrieval endpoint that returns base64-encoded data
4. Update OpenAPI schema and documentation

## Dependencies
- **express** (4.18.2) - Web framework
- **socket.io** (4.8.3) - WebSocket communication
- **@nut-tree-fork/nut-js** (4.2.6) - Peripheral control (keyboard, mouse)
- **screenshot-desktop** (1.15.3) - Screen capture
- **multer** (2.0.2) - File upload handling
- **cors** (2.8.5) - CORS middleware
- **@notionhq/client** (2.2.15) - Notion API integration
- **axios, form-data, socket.io-client** - Testing dependencies

**No linters or build tools** - follows standard JavaScript/Node.js conventions without enforced style checking.

## Notes
- In-memory storage is intentional for this version - data is lost on restart
- Server is designed for local/trusted network use only
- Peripheral control requires proper system permissions on macOS and Linux
- FPS for screen streaming should be kept low (1-2) for monitoring to avoid performance issues

## Quick Reference

### Start Development
```bash
npm install          # Install dependencies
npm start           # Start server (http://localhost:3000)
node test-client.js # Run test suite (in separate terminal)
```

### Common Commands
```bash
npm run export-schema              # Export OpenAPI schema to file
npm run export-schema <base-url>   # Export schema with custom base URL
curl http://localhost:3000/openapi.json  # View live OpenAPI schema
```

### Key Endpoints
- `POST /memory` - Store memory entry
- `GET /memory?userId=...` - Retrieve memory entries
- `POST /control/keyboard/type` - Type text
- `POST /control/mouse/move` - Move cursor
- `GET /capture/screen` - Screenshot
- `ws://localhost:3000` - WebSocket for screen streaming

### When Adding Features
1. Add endpoint handler in `index.js`
2. Update OpenAPI schema in `getOpenApiSpec()` function
3. Update `README.md` with usage examples
4. Add test case to `test-client.js`
5. Update relevant documentation files (INTEGRATION_GUIDE.md, etc.)
