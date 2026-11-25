/**
 * Test client for Nova Memory Server
 * Verifies read-only REST and Socket.IO admission on the local server.
 * Pass --peripherals to also run the interactive, state-changing demo.
 */

const axios = require('axios');
const io = require('socket.io-client');

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.NOVA_MEMORY_API_KEY;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a valid TCP port');
  process.exit(1);
}
if (!apiKey || Buffer.byteLength(apiKey) < 32 || /\s/.test(apiKey)) {
  console.error('Set NOVA_MEMORY_API_KEY to the server bearer key (at least 32 bytes, no whitespace)');
  process.exit(1);
}

const BASE_URL = 'http://127.0.0.1:' + port;
const http = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: 'Bearer ' + apiKey },
  proxy: false,
  maxRedirects: 0,
  timeout: 10000
});
const socketOptions = { auth: { token: apiKey }, reconnection: false, timeout: 5000 };

async function checkAdmission() {
  await http.get('/notion/status');
  await new Promise((resolve, reject) => {
    const socket = io(BASE_URL, socketOptions);
    const deadline = setTimeout(() => finish(new Error('Socket.IO admission timed out')), 6000);
    function finish(error) {
      clearTimeout(deadline);
      socket.disconnect();
      if (error) reject(error);
      else resolve();
    }
    socket.once('connect', () => finish());
    socket.once('connect_error', finish);
  });
  console.log('Authenticated REST and Socket.IO admission passed.');
}

async function testMemoryEndpoints() {
  console.log('\n=== Testing Memory & Journal Endpoints ===');
  
  // Test memory storage
  const memoryResponse = await http.post('/memory', {
    userId: 'test-user',
    topic: 'preferences',
    value: 'Likes screen automation'
  });
  console.log('✓ Memory stored:', memoryResponse.data);
  
  // Test memory retrieval
  const memoryGet = await http.get('/memory?userId=test-user');
  console.log('✓ Memory retrieved:', memoryGet.data);
}

async function testKeyboardControl() {
  console.log('\n=== Testing Keyboard Control ===');
  
  try {
    // Test typing
    const typeResponse = await http.post('/control/keyboard/type', {
      text: 'Test typing'
    });
    console.log('✓ Keyboard type:', typeResponse.data);
  } catch (error) {
    console.log('⚠ Keyboard type (may require display):', error.response?.data || error.message);
  }
  
  try {
    // Test key press
    const keyResponse = await http.post('/control/keyboard/key', {
      key: 'enter'
    });
    console.log('✓ Keyboard key press:', keyResponse.data);
  } catch (error) {
    console.log('⚠ Keyboard key press (may require display):', error.response?.data || error.message);
  }
}

async function testMouseControl() {
  console.log('\n=== Testing Mouse Control ===');
  
  try {
    // Test mouse move
    const moveResponse = await http.post('/control/mouse/move', {
      x: 100,
      y: 100
    });
    console.log('✓ Mouse move:', moveResponse.data);
    
    // Test get position
    const posResponse = await http.get('/control/mouse/position');
    console.log('✓ Mouse position:', posResponse.data);
  } catch (error) {
    console.log('⚠ Mouse control (may require display):', error.response?.data || error.message);
  }
}

async function testScreenCapture() {
  console.log('\n=== Testing Screen Capture ===');
  
  try {
    // Test screen info
    const infoResponse = await http.get('/capture/screen/info');
    console.log('✓ Screen info:', infoResponse.data);
    
    // Test screenshot
    const screenshotResponse = await http.get('/capture/screen?format=png', {
      responseType: 'arraybuffer'
    });
    console.log('✓ Screenshot captured:', screenshotResponse.data.length, 'bytes');
  } catch (error) {
    console.log('⚠ Screen capture (may require display):', error.response?.data || error.message);
  }
}

async function testMediaUpload() {
  console.log('\n=== Testing Media Upload ===');
  
  try {
    const FormData = require('form-data');
    
    // Create a test image buffer
    const testImageBuffer = Buffer.from('fake-image-data');
    const formData = new FormData();
    formData.append('image', testImageBuffer, 'test.png');
    formData.append('userId', 'test-user');
    formData.append('source', 'camera');
    formData.append('description', 'Test image');
    
    const uploadResponse = await http.post('/upload/image', formData, {
      headers: formData.getHeaders()
    });
    console.log('✓ Image uploaded:', uploadResponse.data);
    
    // Test media retrieval
    const mediaList = await http.get('/media?userId=test-user');
    console.log('✓ Media list:', mediaList.data);
  } catch (error) {
    console.log('⚠ Media upload:', error.response?.data || error.message);
  }
}

async function testWebSocketStreaming() {
  console.log('\n=== Testing WebSocket Streaming ===');
  
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, socketOptions);
    socket.once('connect_error', error => {
      socket.disconnect();
      reject(error);
    });
    let frameCount = 0;
    
    socket.on('connect', () => {
      console.log('✓ WebSocket connected');
      socket.emit('start-screen-stream', { fps: 1 });
    });
    
    socket.on('screen-frame', (data) => {
      frameCount++;
      console.log(`✓ Received screen frame #${frameCount} (${data.image.length} chars base64)`);
      
      if (frameCount >= 2) {
        socket.emit('stop-screen-stream');
        socket.disconnect();
        resolve();
      }
    });
    
    socket.on('stream-error', (data) => {
      console.log('⚠ Stream error:', data.error);
      socket.disconnect();
      resolve();
    });
    
    socket.on('disconnect', () => {
      console.log('✓ WebSocket disconnected');
      if (frameCount === 0) {
        resolve();
      }
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (frameCount === 0) {
        console.log('⚠ WebSocket streaming (may require display, no frames received)');
      }
      socket.disconnect();
      resolve();
    }, 5000);
  });
}

async function runAllTests() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--peripherals')) {
    console.error('Usage: node test-client.js [--peripherals]');
    process.exitCode = 1;
    return;
  }
  try {
    await checkAdmission();
    if (args.length === 0) return;
    console.log('Running local keyboard, mouse, capture, memory and upload demo.');
    await testMemoryEndpoints();
    await testKeyboardControl();
    await testMouseControl();
    await testScreenCapture();
    await testMediaUpload();
    await testWebSocketStreaming();
    
    console.log('\n=== All Tests Completed ===');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    process.exit(1);
  }
}

runAllTests();
