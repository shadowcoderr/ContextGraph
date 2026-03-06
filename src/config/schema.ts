// Developer: Shadow Coderr, Architect
export const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    browser: {
      type: 'object',
      properties: {
        channel: { enum: ['msedge', 'chromium', 'firefox'] },
        headless: { type: 'boolean' },
        viewport: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['width', 'height'],
        },
        slowMo: { type: 'number' },
        devtools: { type: 'boolean' },
      },
      required: ['channel', 'headless', 'viewport', 'slowMo', 'devtools'],
    },
    capture: {
      type: 'object',
      properties: {
        screenshots: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            fullPage: { type: 'boolean' },
            elementTargeting: { type: 'boolean' },
          },
        },
        network: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            captureHeaders: { type: 'boolean' },
            captureBody: { type: 'boolean' },
          },
        },
        accessibility: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            includeHidden: { type: 'boolean' },
          },
        },
        locators: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            maxElements: { type: 'number' },
            maxCandidatesPerElement: { type: 'number' },
            includeUniquenessChecks: { type: 'boolean' },
          },
        },
        components: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            minOccurrences: { type: 'number' },
            maxComponents: { type: 'number' },
          },
        },
        forceCapture: { type: 'boolean' },
      },
    },
    security: {
      type: 'object',
      properties: {
        redactPatterns: { type: 'array', items: { type: 'string' } },
        redactHeaders: { type: 'array', items: { type: 'string' } },
        customPatterns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              pattern: { type: 'string' },
              replacement: { type: 'string' },
              severity: { enum: ['critical', 'high', 'medium'] },
            },
            required: ['name', 'pattern', 'replacement', 'severity'],
          },
        },
      },
    },
    storage: {
      type: 'object',
      properties: {
        outputDir: { type: 'string' },
        compression: { type: 'boolean' },
        prettyJson: { type: 'boolean' },
      },
      required: ['outputDir', 'compression', 'prettyJson'],
    },
  },
  required: ['browser', 'capture', 'security', 'storage'],
};
