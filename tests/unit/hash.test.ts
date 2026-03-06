// Developer: Shadow Coderr, Architect
import { generatePageId, generateSessionId } from '../../src/utils/hash';

describe('Hash Utilities', () => {
  describe('generatePageId', () => {
    it('should generate a valid page ID from URL and timestamp', () => {
      const url = 'https://example.com/login';
      const timestamp = new Date('2025-12-13T10:30:45.123Z');
      const id = generatePageId(url, timestamp);

      expect(id).toMatch(/^\d{8}_\d{6}_[a-f0-9]{7}$/);
      expect(id).toContain('20251213_103045');
    });

    it('should generate consistent IDs for the same URL and timestamp', () => {
      const url = 'https://example.com/login';
      const timestamp = new Date('2025-12-13T10:30:45.123Z');
      const id1 = generatePageId(url, timestamp);
      const id2 = generatePageId(url, timestamp);

      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different URLs', () => {
      const timestamp = new Date('2025-12-13T10:30:45.123Z');
      const id1 = generatePageId('https://example.com/login', timestamp);
      const id2 = generatePageId('https://example.com/dashboard', timestamp);

      expect(id1).not.toBe(id2);
    });
  });

  describe('generateSessionId', () => {
    it('should generate a valid session ID from timestamp', () => {
      const timestamp = new Date('2025-12-13T10:30:45.123Z');
      const id = generateSessionId(timestamp);

      expect(id).toMatch(/^session_\d{8}_\d{6}$/);
      expect(id).toContain('session_20251213_103045');
    });

    it('should generate consistent IDs for the same timestamp', () => {
      const timestamp = new Date('2025-12-13T10:30:45.123Z');
      const id1 = generateSessionId(timestamp);
      const id2 = generateSessionId(timestamp);

      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different timestamps', () => {
      const id1 = generateSessionId(new Date('2025-12-13T10:30:45.123Z'));
      const id2 = generateSessionId(new Date('2025-12-13T10:31:45.123Z'));

      expect(id1).not.toBe(id2);
    });
  });
});