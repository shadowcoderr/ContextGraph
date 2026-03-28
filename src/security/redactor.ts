// Developer: Shadow Coderr, Architect
import { RedactionRule } from '../types/config';
import { RedactionAuditEntry } from '../types/storage';
import { BUILTIN_REDACTION_RULES, REDACTED_HEADERS } from './patterns';

export interface RedactionResult {
  originalSize: number;
  redactedSize: number;
  redactions: Array<{
    rule: string;
    count: number;
    locations: string[];
  }>;
  success: boolean;
}

/**
 * Sensitive URL query parameter names.  Values for these parameters are
 * replaced with [REDACTED] in all captured URLs so that tokens, API keys,
 * and session identifiers never reach the filesystem.
 */
const SENSITIVE_QUERY_PARAMS: readonly string[] = [
  'token', 'access_token', 'refresh_token', 'id_token',
  'api_key', 'apikey', 'api-key',
  'auth', 'authorization',
  'key', 'secret', 'password', 'pwd', 'pass',
  'session', 'sessionid', 'session_id',
  'sig', 'signature',
  'code',          // OAuth authorization code
  'state',         // OAuth state — may embed tokens
  'client_secret',
  'private_key',
  'bearer',
];

export class SecurityRedactor {
  private rules: RedactionRule[];
  private redactedHeaders: string[];
  private sensitiveKeys: string[] = [
    'password', 'secret', 'token', 'apiKey', 'api_key',
    'authorization', 'cookie', 'set-cookie', 'privateKey', 'private_key',
  ];
  private auditLog: RedactionAuditEntry[] = [];

  constructor(customRules: RedactionRule[] = []) {
    this.rules = [...BUILTIN_REDACTION_RULES, ...customRules];
    this.redactedHeaders = REDACTED_HEADERS;
  }

  // ── URL sanitisation ────────────────────────────────────────────────────────

  /**
   * Sanitize a URL by replacing the values of sensitive query parameters with
   * [REDACTED].  Returns the original URL string unchanged if parsing fails.
   *
   * Examples:
   *   https://api.example.com/users?api_key=sk_live_123  →  …?api_key=[REDACTED]
   *   https://example.com/callback?code=abc&state=xyz    →  …?code=[REDACTED]&state=[REDACTED]
   */
  sanitizeUrl(url: string): string {
    if (!url) return url;

    try {
      const parsed = new URL(url);
      let changed = false;

      for (const param of SENSITIVE_QUERY_PARAMS) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.set(param, '[REDACTED]');
          changed = true;
        }
      }

      // Also redact any param whose name contains sensitive substrings
      const extraSensitive = ['token', 'key', 'secret', 'password', 'auth'];
      for (const [key] of Array.from(parsed.searchParams.entries())) {
        const lower = key.toLowerCase();
        if (extraSensitive.some(s => lower.includes(s))) {
          parsed.searchParams.set(key, '[REDACTED]');
          changed = true;
        }
      }

      return changed ? parsed.toString() : url;
    } catch {
      return url;
    }
  }

  // ── Main redaction pipeline ─────────────────────────────────────────────────

  async redact(data: any, context: string, url?: string): Promise<RedactionResult> {
    const originalSize = JSON.stringify(data).length;
    const redactions: Array<{ rule: string; count: number; locations: string[] }> = [];

    // 1. Redact sensitive headers (authorization, cookie, etc.)
    if (data && typeof data === 'object' && data.headers) {
      data.headers = this.redactHeaders(data.headers);
    }

    // 2. Key-based redaction (deep object traversal)
    this.redactSensitiveKeys(data, redactions);

    // 3. Pattern-based redaction (regex across all string values)
    for (const rule of this.rules) {
      const result = this.applyRule(data, rule);
      if (result.count > 0) {
        redactions.push({ rule: rule.name, count: result.count, locations: result.locations });
      }
    }

    const redactedSize = JSON.stringify(data).length;

    if (redactions.length > 0) {
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        context,
        url: url ? this.sanitizeUrl(url) : '',
        redactions: redactions.map(r => ({
          rule: r.rule,
          count: r.count,
          field: r.locations.join(', '),
        })),
      });
    }

    return { originalSize, redactedSize, redactions, success: true };
  }

  /**
   * Redact a plain string in-place and return the sanitised version.
   * Useful for response bodies before they are stored.
   */
  async redactString(value: string, _context: string, _url?: string): Promise<string> {
    if (!value) return value;

    let result = value;
    for (const rule of this.rules) {
      result = result.replace(rule.pattern, rule.replacement);
    }

    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private redactSensitiveKeys(data: any, redactions: any[]): void {
    const traverse = (obj: any, path: string = ''): void => {
      if (typeof obj !== 'object' || obj === null) return;

      for (const key in obj) {
        const lowerKey = key.toLowerCase();
        const currentPath = path ? `${path}.${key}` : key;

        if (this.sensitiveKeys.some(sk => lowerKey.includes(sk))) {
          const ruleName = `sensitive_key:${key}`;
          obj[key] = '[REDACTED:SENSITIVE_KEY]';

          const existing = redactions.find(r => r.rule === ruleName);
          if (existing) {
            existing.count++;
            existing.locations.push(currentPath);
          } else {
            redactions.push({ rule: ruleName, count: 1, locations: [currentPath] });
          }
        } else {
          traverse(obj[key], currentPath);
        }
      }
    };
    traverse(data);
  }

  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    const redacted = { ...headers };
    for (const header of this.redactedHeaders) {
      const lower = header.toLowerCase();
      const actualKey = Object.keys(redacted).find(k => k.toLowerCase() === lower);
      if (actualKey) {
        redacted[actualKey] = '[REDACTED]';
      }
    }
    return redacted;
  }

  private applyRule(data: any, rule: RedactionRule): { count: number; locations: string[] } {
    let count = 0;
    const locations: string[] = [];

    const traverse = (obj: any, path: string = ''): void => {
      if (typeof obj !== 'object' || obj === null) return;

      for (const key in obj) {
        const val = obj[key];
        if (typeof val === 'string') {
          // Reset lastIndex for global regexes to avoid stateful match issues
          rule.pattern.lastIndex = 0;
          const matches = val.match(rule.pattern);
          if (matches) {
            count += matches.length;
            locations.push(path ? `${path}.${key}` : key);
            rule.pattern.lastIndex = 0;
            obj[key] = val.replace(rule.pattern, rule.replacement);
            // Reset again after replace
            rule.pattern.lastIndex = 0;
          }
        } else {
          traverse(val, path ? `${path}.${key}` : key);
        }
      }
    };

    traverse(data);
    return { count, locations };
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  getAuditLog(): RedactionAuditEntry[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }

  /** Returns the number of distinct redaction events across all contexts */
  getTotalRedactionCount(): number {
    return this.auditLog.reduce((sum, entry) => {
      return sum + entry.redactions.reduce((s, r) => s + r.count, 0);
    }, 0);
  }
}
