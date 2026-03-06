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

export class SecurityRedactor {
  private rules: RedactionRule[];
  private redactedHeaders: string[];
  private sensitiveKeys: string[] = ['password', 'secret', 'token', 'apiKey', 'api_key', 'authorization', 'cookie', 'set-cookie'];
  private auditLog: RedactionAuditEntry[] = [];

  constructor(customRules: RedactionRule[] = []) {
    this.rules = [...BUILTIN_REDACTION_RULES, ...customRules];
    this.redactedHeaders = REDACTED_HEADERS;
  }

  async redact(data: any, context: string, url?: string): Promise<RedactionResult> {
    const originalSize = JSON.stringify(data).length;
    let redactedData = data; // Note: we mutate in place if it's an object
    const redactions: Array<{ rule: string; count: number; locations: string[] }> = [];

    // Redact headers if present
    if (redactedData.headers) {
      redactedData.headers = this.redactHeaders(redactedData.headers);
    }

    // Apply key-based redaction
    this.redactSensitiveKeys(redactedData, redactions);

    // Apply all pattern-based redaction rules
    for (const rule of this.rules) {
      const result = this.applyRule(redactedData, rule);
      if (result.count > 0) {
        redactions.push({
          rule: rule.name,
          count: result.count,
          locations: result.locations,
        });
      }
    }

    const redactedSize = JSON.stringify(redactedData).length;

    // Log to audit
    if (redactions.length > 0) {
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        context,
        url: url || '',
        redactions: redactions.map(r => ({
          rule: r.rule,
          count: r.count,
          field: r.locations.join(', '),
        })),
      });
    }

    return {
      originalSize,
      redactedSize,
      redactions,
      success: true,
    };
  }

  private redactSensitiveKeys(data: any, redactions: any[]): void {
    const traverse = (obj: any, path: string = ''): void => {
      if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
          const lowerKey = key.toLowerCase();
          const currentPath = path ? `${path}.${key}` : key;
          
          if (this.sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            const ruleName = `sensitive_key:${key}`;
            obj[key] = '[REDACTED:SENSITIVE_KEY]';
            
            // Track this redaction
            let existingRedaction = redactions.find(r => r.rule === ruleName);
            if (existingRedaction) {
              existingRedaction.count++;
              existingRedaction.locations.push(currentPath);
            } else {
              redactions.push({ rule: ruleName, count: 1, locations: [currentPath] });
            }
          } else {
            traverse(obj[key], currentPath);
          }
        }
      }
    };
    traverse(data);
  }

  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    const redacted = { ...headers };
    for (const header of this.redactedHeaders) {
      const lowerHeader = header.toLowerCase();
      // Find the key in headers regardless of case
      const actualKey = Object.keys(redacted).find(k => k.toLowerCase() === lowerHeader);
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
      if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
          const val = obj[key];
          if (typeof val === 'string') {
            const matches = val.match(rule.pattern);
            if (matches) {
              count += matches.length;
              locations.push(path ? `${path}.${key}` : key);
              // Replace in place - this now correctly mutates the object property
              obj[key] = val.replace(rule.pattern, rule.replacement);
            }
          } else {
            traverse(val, path ? `${path}.${key}` : key);
          }
        }
      }
    };

    traverse(data);
    return { count, locations };
  }

  getAuditLog(): RedactionAuditEntry[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }
}
