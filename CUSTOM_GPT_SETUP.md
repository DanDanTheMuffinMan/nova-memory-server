# Custom GPT Setup Guide for Nova Memory Server

This guide shows you how to connect your Custom GPT to the Nova Memory Server, enabling it to control your computer, capture screenshots, and manage memory/journal entries.

## Prerequisites

1. **Nova Memory Server running on your machine:**
   ```bash
   npm install
   npm start
   ```

2. **A ChatGPT Plus or Enterprise account** to create Custom GPTs

## Option 1: Using a Tunnel Service (Recommended for Testing)

Since Custom GPTs run on OpenAI's servers and cannot access `localhost` directly, you need to expose your local server via a tunnel service.

### Using ngrok (Easiest)

1. **Install ngrok:**
   - Download from https://ngrok.com/download
   - Or via npm: `npm install -g ngrok`
   - Sign up for a free account at https://ngrok.com

2. **Start your Nova Memory Server:**
   ```bash
   npm start
   ```

3. **In a new terminal, start ngrok:**
   ```bash
   ngrok http 3000
   ```

4. **Copy the forwarding URL** (looks like `https://abc123.ngrok.io`)

5. **Configure your Custom GPT:**
   - Go to https://chat.openai.com/gpts/editor
   - Create a new GPT or edit an existing one
   - Go to the "Actions" tab
   - Click "Import from URL"
   - Paste: `https://YOUR-NGROK-URL.ngrok.io/openapi.json`
   - Click "Import"

### Using Cloudflare Tunnel (Alternative)

1. **Install cloudflared:**
   ```bash
   # macOS
   brew install cloudflare/cloudflare/cloudflared
   
   # Windows
   # Download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
   
   # Linux
   wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared-linux-amd64.deb
   ```

2. **Start the tunnel:**
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

3. **Copy the tunnel URL** and follow steps 5 above, replacing ngrok URL with your Cloudflare tunnel URL

### Using localtunnel (Another Alternative)

1. **Install localtunnel:**
   ```bash
   npm install -g localtunnel
   ```

2. **Start the tunnel:**
   ```bash
   lt --port 3000
   ```

3. **Follow step 5** above with the provided URL

## Option 2: Manual Schema Import (Works Without Internet)

If you don't want to use a tunnel or expose your server, you can manually paste the OpenAPI schema:

1. **Generate the schema file:**
   ```bash
   node export-openapi.js
   ```

2. **Open the generated `openapi.json` file**

3. **In Custom GPT Actions:**
   - Go to https://chat.openai.com/gpts/editor
   - Create/edit your GPT
   - Go to "Actions" tab
   - Instead of "Import from URL", paste the entire contents of `openapi.json` directly

4. **Update the server URL:**
   - In the schema editor, find the `servers` section
   - If using a tunnel, replace `http://localhost:3000` with your tunnel URL
   - If not using a tunnel, you'll need to manually update this each time you create a new tunnel

## Option 3: Deploy to a Cloud Server

For production use, deploy the server to a cloud platform:

### Heroku
```bash
# Install Heroku CLI, then:
heroku create your-nova-server
git push heroku main
```

### Railway
1. Visit https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Select this repository
4. Railway will auto-detect and deploy

### DigitalOcean, AWS, etc.
Deploy as you would any Node.js Express application.

⚠️ **Security Warning:** When deploying publicly:
- Add authentication (JWT, API keys)
- Use HTTPS only
- Restrict peripheral control endpoints to trusted IPs
- Consider rate limiting

## Configuring Your Custom GPT

After importing the schema, configure your GPT:

### 1. Instructions (Suggested)

```
You are Nova, an AI assistant with the ability to control the user's computer.

You have access to these capabilities:
- Memory: Store and retrieve information about the user
- Journal: Save diary/journal entries
- Keyboard Control: Type text and press keys (including shortcuts)
- Mouse Control: Move cursor, click, scroll
- Screen Capture: Take screenshots to see what's on screen
- Media Upload: Receive images and audio from the user

IMPORTANT GUIDELINES:
1. Always confirm before performing destructive actions
2. Ask for permission before controlling keyboard/mouse
3. Use screen capture to verify actions were successful
4. Store important preferences in memory for future conversations
5. Be helpful and respectful of the user's computer

When the user asks you to do something on their computer:
1. Capture a screenshot first (if relevant)
2. Explain what you're about to do
3. Perform the action
4. Verify it worked (capture another screenshot if needed)

Remember: You can see what's on the screen, control input devices, and remember things across conversations!
```

### 2. Name
Something like: **Nova - Computer Control Assistant**

### 3. Description
```
An AI assistant that can control your computer, manage memory, and capture screenshots. Requires Nova Memory Server running locally.
```

### 4. Conversation Starters
- "Take a screenshot and tell me what's on my screen"
- "Remember that I prefer dark mode for coding"
- "Open a text editor and write a quick note"
- "What did I save in my journal last week?"

## Testing Your Setup

Once configured, test with these prompts:

### Test Memory
```
Store this in memory: My favorite color is blue
```
Then in a new conversation:
```
What's my favorite color?
```

### Test Screen Capture (if display available)
```
Take a screenshot and describe what you see
```

### Test Keyboard Control (CAREFUL!)
```
Open notepad and type "Hello from Nova!"
```

### Test Mouse Control (CAREFUL!)
```
Move my mouse to coordinates (500, 500)
```

## Troubleshooting

### "Action failed" or Connection errors

**Problem:** GPT can't reach your server

**Solutions:**
1. Check that Nova Memory Server is running (`npm start`)
2. If using a tunnel, ensure it's still active (tunnels can timeout)
3. Verify the server URL in the Actions schema matches your tunnel URL
4. Check firewall settings

### "Peripheral control not available"

**Problem:** Server can't access keyboard/mouse/screen

**Solutions:**
- **Linux:** Ensure DISPLAY environment variable is set: `echo $DISPLAY`
- **macOS:** Grant Accessibility permissions: System Preferences → Security & Privacy → Accessibility
- **All:** The server must be running on a machine with a display (not headless)
- **Note:** Memory and journal features work even without display access

### Tunnel keeps disconnecting

**Problem:** Free tunnel services may have connection limits

**Solutions:**
- ngrok free tier: Tunnels last 8 hours
- Create a new tunnel and update the Custom GPT actions URL
- Consider ngrok paid plan or deploying to cloud

### "Schema validation failed"

**Problem:** OpenAPI schema has errors

**Solutions:**
1. Re-export the schema: `node export-openapi.js`
2. Ensure you're using the latest version from the repo
3. Check for syntax errors if you manually edited the schema

### Actions not appearing in GPT

**Problem:** Schema imported but actions don't work

**Solutions:**
1. Click "Test" button next to each action in the Actions panel
2. Check the server logs for incoming requests
3. Verify the server URL is correct in the schema
4. Try deleting and re-importing the schema

## Security Best Practices

⚠️ **IMPORTANT:** This server gives AI control over your computer. Use responsibly!

1. **Only use trusted tunnel services** (ngrok, Cloudflare)
2. **Never share your tunnel URL** publicly
3. **Monitor the server logs** to see what actions are being taken
4. **Run on a non-critical machine** when testing
5. **Always review what the AI plans to do** before confirming
6. **Use keyboard shortcuts** to quickly close applications if needed (Alt+F4, Cmd+Q)
7. **Keep backups** of important data
8. **Consider using a VM** for testing

## Advanced: Custom Server URL per Export

If you want to generate a schema with a specific URL (e.g., your tunnel URL):

```bash
node export-openapi.js https://your-tunnel-url.ngrok.io
```

This creates `openapi.json` with your URL pre-configured.

## Example Workflow

Here's a complete workflow to get started:

1. **Terminal 1 - Start Server:**
   ```bash
   npm start
   ```

2. **Terminal 2 - Start Tunnel:**
   ```bash
   ngrok http 3000
   ```

3. **Copy the ngrok URL** (e.g., `https://abc123.ngrok.io`)

4. **Open ChatGPT:**
   - Go to https://chat.openai.com/gpts/editor
   - Create new GPT
   - Name it "Nova"
   - Add instructions (see above)
   - Go to Actions → Import from URL
   - Paste: `https://abc123.ngrok.io/openapi.json`
   - Click Import

5. **Test it:**
   - "Take a screenshot"
   - "Remember that I work in software engineering"
   - "Add a journal entry: Today was productive"

6. **Use it:**
   - Ask Nova to help with computer tasks
   - Have it remember preferences
   - Let it see and control your screen

## Need Help?

- **Documentation:** See [README.md](README.md) for API details
- **Examples:** Check [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for code examples
- **Quick Start:** See [QUICKSTART.md](QUICKSTART.md) for server setup
- **Issues:** https://github.com/DanDanTheMuffinMan/nova-memory-server/issues

## What's Next?

Once your Custom GPT is working:

- Experiment with different prompts
- Have Nova help with repetitive tasks
- Use memory to build a personalized assistant
- Try screen monitoring workflows
- Build custom integrations (see INTEGRATION_GUIDE.md)

Happy automating! 🚀
