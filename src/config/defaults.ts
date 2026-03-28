// Developer: Shadow Coderr, Architect
import { Config } from '../types/config';

export const DEFAULT_CONFIG: Config = {
  browser: {
    channel: 'msedge',
    headless: false,
    viewport: {
      width: 1920,
      height: 1080,
    },
    slowMo: 0,
  },
  capture: {
    screenshots: {
      enabled: true,
      fullPage: true,
      elementTargeting: true,
    },
    network: {
      enabled: true,
      captureHeaders: true,
      captureBody: false,
    },
    accessibility: {
      enabled: true,
      includeHidden: false,
    },
    locators: {
      enabled: true,
      maxElements: 500,
      maxCandidatesPerElement: 6,
      includeUniquenessChecks: true,
    },
    components: {
      enabled: true,
      minOccurrences: 1,
      maxComponents: 1000,
    },
    notifications: {
      enabled: true,
    },
    forceCapture: false,
  },
  security: {
    redactPatterns: ['jwt', 'creditcard', 'ssn'],
    redactHeaders: ['authorization', 'cookie', 'x-api-key'],
    customPatterns: [],
  },
  storage: {
    outputDir: './context-graph-output',
    compression: false,
    prettyJson: true,
  },
};
