'use strict';

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

// Lightweight OpenAPI schema for Custom GPT / action import
const getOpenApiSpec = (serverUrl) => ({
  openapi: '3.0.0',
  security: [{ bearerAuth: [] }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
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
                  value: { type: 'string' },
                  syncToNotion: { type: 'boolean', description: 'Sync this entry to Notion if configured' }
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
                  properties: {
                    success: { type: 'boolean' },
                    notion: {
                      type: 'object',
                      properties: {
                        synced: { type: 'boolean' },
                        pageId: { type: 'string' },
                        error: { type: 'string' }
                      }
                    }
                  }
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
                  content: { type: 'string' },
                  syncToNotion: { type: 'boolean', description: 'Sync this entry to Notion if configured' }
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
                  properties: {
                    success: { type: 'boolean' },
                    notion: {
                      type: 'object',
                      properties: {
                        synced: { type: 'boolean' },
                        pageId: { type: 'string' },
                        error: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing required fields'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/notion/status': {
      get: {
        operationId: 'getNotionStatus',
        summary: 'Check Notion integration status',
        responses: {
          200: {
            description: 'Notion status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['configured', 'missing'],
                  properties: {
                    configured: { type: 'boolean' },
                    missing: { type: 'array', items: { type: 'string' } },
                    databases: {
                      type: 'object',
                      properties: {
                        memory: { type: 'boolean' },
                        journal: { type: 'boolean' }
                      }
                    }
                  }
                }
              }
            }
          },
          500: errorResponse('Internal server error')
        }
      }
    },
    '/notion/memory': {
      post: {
        operationId: 'syncMemoryToNotion',
        summary: 'Create a Notion page for a memory entry',
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
                  value: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Notion page created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'pageId'],
                  properties: {
                    success: { type: 'boolean' },
                    pageId: { type: 'string' }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing required fields'),
          503: errorResponse('Notion not configured'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/notion/journal': {
      post: {
        operationId: 'syncJournalToNotion',
        summary: 'Create a Notion page for a journal entry',
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
                  content: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Notion page created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'pageId'],
                  properties: {
                    success: { type: 'boolean' },
                    pageId: { type: 'string' }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing required fields'),
          503: errorResponse('Notion not configured'),
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
                  required: ['success', 'position'],
                  properties: {
                    success: { type: 'boolean' },
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
                  required: ['success', 'screen'],
                  properties: {
                    success: { type: 'boolean' },
                    screen: {
                      type: 'object',
                      properties: {
                        width: { type: 'integer' },
                        height: { type: 'integer' }
                      }
                    }
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
    '/upload/image': {
      post: {
        operationId: 'uploadImage',
        summary: 'Upload an image',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['image', 'userId'],
                properties: {
                  image: { type: 'string', format: 'binary' },
                  userId: { type: 'string' },
                  source: { type: 'string' },
                  description: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Uploaded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'message', 'mediaId'],
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    mediaId: { type: 'integer' }
                  }
                }
              }
            }
          },
          400: errorResponse('Bad Request - missing userId or image file'),
          500: errorResponse('Internal server error')
        }
      }
    },
    '/upload/audio': {
      post: {
        operationId: 'uploadAudio',
        summary: 'Upload an audio recording',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['audio', 'userId'],
                properties: {
                  audio: { type: 'string', format: 'binary' },
                  userId: { type: 'string' },
                  description: { type: 'string' },
                  duration: { type: 'number', description: 'Duration in seconds' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Uploaded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'message', 'mediaId'],
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    mediaId: { type: 'integer' }
                  }
                }
              }
            }
          },
          400: errorResponse('Bad Request - missing userId or audio file'),
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
    },
    '/bridge/entry': {
      post: {
        operationId: 'bridgeEntry',
        summary: 'Store a memory/journal entry and optionally sync to UNOVA and Notion',
        parameters: [{
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: 'Optional stable retry identifier (max 128 ASCII characters). Identical requests replay their result for up to 10 minutes per process; changed bodies return 409. Not durable across restarts.',
          schema: { type: 'string', maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }
        }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'entryType'],
                properties: {
                  userId: { type: 'string' },
                  entryType: { type: 'string', enum: ['memory', 'journal'] },
                  topic: { type: 'string', description: 'Memory topic (required for memory)' },
                  value: { type: 'string', description: 'Memory value (required for memory)' },
                  title: { type: 'string', description: 'Journal title (required for journal)' },
                  content: { type: 'string', description: 'Journal content (required for journal)' },
                  tags: { type: 'array', items: { type: 'string' } },
                  notion: {
                    type: 'object',
                    description: 'Optional Notion property/version overrides. Database and token are server-owned; databaseId, if supplied, must match the configured database for the entry type.',
                    properties: {
                      databaseId: { type: 'string', description: 'Optional assertion of configured database; cannot change destination' },
                      titleProperty: { type: 'string' },
                      tagsProperty: { type: 'string' },
                      userProperty: { type: 'string' },
                      entryTypeProperty: { type: 'string' },
                      version: { type: 'string' }
                    }
                  },
                  unova: {
                    type: 'object',
                    description: 'Optional event name for the configured UNOVA destination',
                    properties: {
                      eventName: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Stored and synced',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    stored: { type: 'object' },
                    notion: { type: 'object' },
                    unova: { type: 'object' }
                  }
                }
              }
            }
          },
          400: errorResponse('Missing required fields'),
          500: errorResponse('Internal server error')
        }
      }
    }
  }
});

function parsePublicOrigin(value) {
  if (!value) return undefined;
  const url = URL.canParse(value) ? new URL(value) : null;
  if (!url || url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NOVA_MEMORY_PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment');
  }
  return url.origin;
}

module.exports = { getOpenApiSpec, parsePublicOrigin };
