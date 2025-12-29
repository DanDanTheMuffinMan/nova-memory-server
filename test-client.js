/**
 * Test client for Nova Memory Server
 * Demonstrates usage of all peripheral control and media capture endpoints
 */

const axios = require('axios');
const io = require('socket.io-client');

const BASE_URL = 'http://localhost:3000';

async function testMemoryEndpoints() {
  console.log('\n=== Testing Memory & Journal Endpoints ===');
  
  // Test memory storage
  const memoryResponse = await axios.post(`${BASE_URL}/memory`, {
    userId: 'test-user',
    topic: 'preferences',
    value: 'Likes screen automation'
  });
  console.log('✓ Memory stored:', memoryResponse.data);
  
  // Test memory retrieval
  const memoryGet = await axios.get(`${BASE_URL}/memory?userId=test-user`);
  console.log('✓ Memory retrieved:', memoryGet.data);
}

async function testKeyboardControl() {
  console.log('\n=== Testing Keyboard Control ===');
  
  try {
    // Test typing
    const typeResponse = await axios.post(`${BASE_URL}/control/keyboard/type`, {
      text: 'Test typing'
    });
    console.log('✓ Keyboard type:', typeResponse.data);
  } catch (error) {
    console.log('⚠ Keyboard type (may require display):', error.response?.data || error.message);
  }
  
  try {
    // Test key press
    const keyResponse = await axios.post(`${BASE_URL}/control/keyboard/key`, {
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
    const moveResponse = await axios.post(`${BASE_URL}/control/mouse/move`, {
      x: 100,
      y: 100
    });
    console.log('✓ Mouse move:', moveResponse.data);
    
    // Test get position
    const posResponse = await axios.get(`${BASE_URL}/control/mouse/position`);
    console.log('✓ Mouse position:', posResponse.data);
  } catch (error) {
    console.log('⚠ Mouse control (may require display):', error.response?.data || error.message);
  }
}

async function testScreenCapture() {
  console.log('\n=== Testing Screen Capture ===');
  
  try {
    // Test screen info
    const infoResponse = await axios.get(`${BASE_URL}/capture/screen/info`);
    console.log('✓ Screen info:', infoResponse.data);
    
    // Test screenshot
    const screenshotResponse = await axios.get(`${BASE_URL}/capture/screen?format=png`, {
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
    const fs = require('fs');
    
    // Create a test image buffer
    const testImageBuffer = Buffer.from('fake-image-data');
    const formData = new FormData();
    formData.append('image', testImageBuffer, 'test.png');
    formData.append('userId', 'test-user');
    formData.append('source', 'camera');
    formData.append('description', 'Test image');
    
    const uploadResponse = await axios.post(`${BASE_URL}/upload/image`, formData, {
      headers: formData.getHeaders()
    });
    console.log('✓ Image uploaded:', uploadResponse.data);
    
    // Test media retrieval
    const mediaList = await axios.get(`${BASE_URL}/media?userId=test-user`);
    console.log('✓ Media list:', mediaList.data);
  } catch (error) {
    console.log('⚠ Media upload:', error.response?.data || error.message);
  }
}

async function testWebSocketStreaming() {
  console.log('\n=== Testing WebSocket Streaming ===');
  
  return new Promise((resolve) => {
    const socket = io(BASE_URL);
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
  console.log('Starting Nova Memory Server Tests...');
  console.log('Note: Some tests may fail in headless environments');
  
  try {
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
