#!/usr/bin/env node
/**
 * Export OpenAPI schema to a static file
 * This allows you to copy/paste the schema into Custom GPT actions
 * or import it from a URL if you're running the server with ngrok/similar
 */

const fs = require('fs');
let yaml;
try {
  yaml = require('js-yaml');
} catch (err) {
  // js-yaml is optional
}

// Import the getOpenApiSpec function from index.js
// We'll generate the spec with a placeholder URL that users can customize
const serverUrl = process.argv[2] || 'http://localhost:3000';

// Define the same schema structure from index.js
const errorResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } }
      }
    }
  }
});

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Nova Memory Server',
    version: '1.0.0',
    description: 'Actions for memory, journal, peripheral control, and capture. Warning: peripheral endpoints allow keyboard/mouse control and screen capture; keep server on trusted/local networks.'
  },
  servers: [{ url: serverUrl }],
  paths: {
    '/memory': {
      get: {
        operationId: 'getMemory',
        summary: 'Retrieve memory entries',
        parameters: [
          {
            name: 'userId',
            in: 'query',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'Memory entries',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      topic: { type: 'string' },
                      value: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing userId'),
          500: errorResponse('Internal server error')
        }
      },
      post: {
        operationId: 'storeMemory',
        summary: 'Store a memory entry',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'topic', 'value'],
                properties: {
                  userId: { type: 'string' },
                  topic: { type: 'string' },
                  value: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Stored',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success'],
                  properties: { success: { type: 'boolean' } }
                }
              }
            }
          },
          400: errorResponse('Missing required fields'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/journal': {
      get: {
        operationId: 'getJournal',
        summary: 'Retrieve journal entries',
        parameters: [
          {
            name: 'userId',
            in: 'query',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'Journal entries',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      content: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing userId'),
          500: errorResponse('Internal server error')
        }
      },
      post: {
        operationId: 'storeJournal',
        summary: 'Store a journal entry',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'title', 'content'],
                properties: {
                  userId: { type: 'string' },
                  title: { type: 'string' },
                  content: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Stored',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success'],
                  properties: { success: { type: 'boolean' } }
                }
              }
            }
          },
          400: errorResponse('Missing required fields'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/control/keyboard/type': {
      post: {
        operationId: 'typeText',
        summary: 'Type text using keyboard',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: { text: { type: 'string' } }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Typed text',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'message'],
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing text'),
          503: errorResponse('Peripheral control unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/control/keyboard/key': {
      post: {
        operationId: 'pressKey',
        summary: 'Press a specific key with optional modifiers',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['key'],
                properties: {
                  key: { type: 'string', description: 'Key to press (e.g., "enter", "a", "f1")' },
                  modifiers: { 
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional modifiers: leftcontrol, leftshift, leftalt, leftsuper'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Key pressed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'message'],
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing key'),
          503: errorResponse('Peripheral control unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/control/mouse/move': {
      post: {
        operationId: 'moveMouse',
        summary: 'Move mouse cursor',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['x', 'y'],
                properties: {
                  x: { type: 'integer' },
                  y: { type: 'integer' },
                  smooth: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Mouse moved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'message'],
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing coordinates'),
          503: errorResponse('Peripheral control unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/control/mouse/click': {
      post: {
        operationId: 'clickMouse',
        summary: 'Click mouse button',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  button: { type: 'string', enum: ['left', 'right', 'middle'] },
                  double: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Clicked',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'message'],
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          503: errorResponse('Peripheral control unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/control/mouse/position': {
      get: {
        operationId: 'getMousePosition',
        summary: 'Get current mouse cursor position',
        responses: {
          200: {
            description: 'Mouse position',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['position'],
                  properties: {
                    position: {
                      type: 'object',
                      properties: {
                        x: { type: 'integer' },
                        y: { type: 'integer' }
                      }
                    }
                  }
                }
              }
            }
          },
          503: errorResponse('Peripheral control unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/control/mouse/scroll': {
      post: {
        operationId: 'scrollMouse',
        summary: 'Scroll mouse wheel',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: {
                  amount: { 
                    type: 'integer',
                    description: 'Scroll amount (negative for up, positive for down)'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Scrolled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'message'],
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing amount'),
          503: errorResponse('Peripheral control unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/capture/screen': {
      get: {
        operationId: 'captureScreen',
        summary: 'Capture screenshot',
        parameters: [
          {
            name: 'format',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['png', 'jpg', 'jpeg'] }
          }
        ],
        responses: {
          200: {
            description: 'Binary image data',
            content: {
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/jpeg': { schema: { type: 'string', format: 'binary' } }
            }
          },
          400: errorResponse('Invalid format'),
          503: errorResponse('Screen capture unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/capture/screen/info': {
      get: {
        operationId: 'getScreenInfo',
        summary: 'Get screen dimensions',
        responses: {
          200: {
            description: 'Screen dimensions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    width: { type: 'integer' },
                    height: { type: 'integer' }
                  }
                }
              }
            }
          },
          503: errorResponse('Screen capture unavailable'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/media': {
      get: {
        operationId: 'listMedia',
        summary: 'List uploaded media for a user',
        parameters: [
          {
            name: 'userId',
            in: 'query',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'Media list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      mediaId: { type: 'integer' },
                      type: { type: 'string' },
                      source: { type: 'string' },
                      description: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing userId'),
          500: errorResponse('Internal server error')
        }
      }
    }
  }
};

// Export as JSON
fs.writeFileSync('openapi.json', JSON.stringify(openApiSpec, null, 2));
console.log('✓ Exported to openapi.json');

// Export as YAML if js-yaml is available
if (yaml) {
  try {
    const yamlStr = yaml.dump(openApiSpec, { lineWidth: -1 });
    fs.writeFileSync('openapi.yaml', yamlStr);
    console.log('✓ Exported to openapi.yaml');
  } catch (err) {
    console.log('⚠ YAML export failed:', err.message);
  }
} else {
  console.log('⚠ YAML export skipped (install js-yaml for YAML export: npm install js-yaml)');
}

console.log('\nYou can now:');
console.log('1. Copy the contents of openapi.json or openapi.yaml');
console.log('2. Paste into Custom GPT Actions');
console.log('3. Or use with: Import from URL → your-server-url/openapi.json');
console.log(`\nCurrent server URL in schema: ${serverUrl}`);
console.log('To change URL: node export-openapi.js https://your-url.com');
