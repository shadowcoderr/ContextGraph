// Developer: Shadow Coderr, Architect
import { SecurityRedactor } from '../../src/security/redactor';
import { DataValidator } from '../../src/security/validator';

describe('Security Module', () => {
  describe('SecurityRedactor', () => {
    let redactor: SecurityRedactor;

    beforeEach(() => {
      redactor = new SecurityRedactor();
    });

    it('should redact JWT tokens', async () => {
      const data = {
        auth_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      };

      const result = await redactor.redact(data, 'test');
      expect(result.success).toBe(true);
      expect(result.redactions.length).toBeGreaterThan(0);
      expect(result.redactions[0].rule).toBe('sensitive_key:auth_token');
    });

    it('should redact JWT tokens using pattern matching', async () => {
      const data = {
        data: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      };

      const result = await redactor.redact(data, 'test');
      expect(result.success).toBe(true);
      expect(result.redactions.length).toBeGreaterThan(0);
      expect(result.redactions[0].rule).toBe('jwt_token');
    });

    it('should redact sensitive headers', async () => {
      const headers = {
        'authorization': 'Bearer token123456789',
        'content-type': 'application/json',
        'x-api-key': 'sk_live_12345678901234567890',
      };

      const result = await redactor.redact(headers, 'test_headers');
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it('should redact credit card numbers', async () => {
      const data = {
        card: '4532 1488 0343 6467',
      };

      const result = await redactor.redact(data, 'test_cc');
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it('should redact SSN numbers', async () => {
      const data = {
        ssn: '123-45-6789',
      };

      const result = await redactor.redact(data, 'test_ssn');
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it('should maintain audit log', async () => {
      await redactor.redact({ token: 'eyJhbGciOiJIUzI1NiJ9.test.test' }, 'test1');
      await redactor.redact({ card: '1234 5678 9012 3456' }, 'test2');

      const audit = redactor.getAuditLog();
      expect(audit.length).toBeGreaterThanOrEqual(1);
    });

    it('should clear audit log', async () => {
      await redactor.redact({ token: 'eyJhbGciOiJIUzI1NiJ9.test.test' }, 'test');
      let audit = redactor.getAuditLog();
      expect(audit.length).toBeGreaterThan(0);

      redactor.clearAuditLog();
      audit = redactor.getAuditLog();
      expect(audit).toHaveLength(0);
    });
  });

  describe('DataValidator', () => {
    let validator: DataValidator;

    beforeEach(() => {
      validator = new DataValidator();
    });

    it('should validate correct page snapshot', () => {
      const snapshot = {
        metadata: {
          captureId: 'test_id',
          timestamp: '2025-12-13T10:30:45.123Z',
          url: 'https://example.com',
          domain: 'example.com',
          title: 'Test',
          viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
          timing: { navigationStart: 0, domContentLoaded: 1, loadComplete: 2, networkIdle: 3 },
          performance: { domNodes: 10, scripts: 1, stylesheets: 1, images: 0, totalRequests: 5 },
          userAgent: 'test',
          cookies: '[REDACTED]',
          mode: 'browser' as const,
        },
        domSnapshot: '<html></html>',
        a11yTree: { role: 'root', name: '', children: [] },
        locators: { elements: [] },
        frames: { url: 'https://example.com', name: '', children: [] },
        networkEvents: [],
        consoleMessages: [],
        screenshotPaths: [],
      };

      const result = validator.validatePageSnapshot(snapshot);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const snapshot = {
        metadata: {
          url: '',
          domain: '',
          // Missing other required fields
        },
        domSnapshot: '',
      } as any;

      const result = validator.validatePageSnapshot(snapshot);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate network events', () => {
      const event = {
        timestamp: '2025-12-13T10:30:45.123Z',
        type: 'request' as const,
        url: 'https://example.com/api',
      };

      const result = validator.validateNetworkEvent(event);
      expect(result.valid).toBe(true);
    });

    it('should detect invalid network events', () => {
      const event = {
        type: 'invalid',
        url: 'https://example.com/api',
      };

      const result = validator.validateNetworkEvent(event as any);
      expect(result.valid).toBe(false);
    });
  });
});