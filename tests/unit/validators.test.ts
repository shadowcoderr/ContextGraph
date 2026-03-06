// Developer: Shadow Coderr, Architect
import { isValidUrl, isValidDirectory, validateConfig } from '../../src/utils/validators';

describe('Validators', () => {
  describe('isValidUrl', () => {
    it('should validate correct HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com:8080/path?query=1')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('isValidDirectory', () => {
    it('should validate non-empty strings', () => {
      expect(isValidDirectory('./output')).toBe(true);
      expect(isValidDirectory('/absolute/path')).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(isValidDirectory('')).toBe(false);
    });

    it('should reject non-strings', () => {
      expect(isValidDirectory(null as any)).toBe(false);
      expect(isValidDirectory(undefined as any)).toBe(false);
    });
  });

  describe('validateConfig', () => {
    const validConfig = {
      browser: {
        channel: 'msedge',
        headless: false,
        viewport: { width: 1920, height: 1080 },
        slowMo: 0,
        devtools: false,
      },
      capture: {
        screenshots: { enabled: true, fullPage: true, elementTargeting: true },
        network: { enabled: true, captureHeaders: true, captureBody: false },
        accessibility: { enabled: true, includeHidden: false },
      },
      security: {
        redactPatterns: [],
        redactHeaders: [],
        customPatterns: [],
      },
      storage: {
        outputDir: './output',
        compression: false,
        prettyJson: true,
      },
    };

    it('should validate correct configuration', () => {
      const result = validateConfig(validConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid browser channel', () => {
      const config = { ...validConfig, browser: { ...validConfig.browser, channel: 'safari' } };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject missing required sections', () => {
      const config = {
        ...validConfig,
        browser: undefined,
      } as any;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });
});