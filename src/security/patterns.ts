// Developer: Shadow Coderr, Architect
import { RedactionRule } from '../types/config';

export const BUILTIN_REDACTION_RULES: RedactionRule[] = [
  {
    name: 'jwt_token',
    pattern: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
    replacement: '[REDACTED:JWT]',
    severity: 'critical',
  },
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: '[REDACTED:BEARER]',
    severity: 'critical',
  },
  {
    name: 'credit_card',
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[REDACTED:CC]',
    severity: 'critical',
  },
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[REDACTED:SSN]',
    severity: 'critical',
  },
  {
    name: 'api_key',
    pattern: /[Aa][Pp][Ii][-_]?[Kk][Ee][Yy][\s:=]+['""]?([A-Za-z0-9_\-]{20,})['""]?/g,
    replacement: '[REDACTED:API_KEY]',
    severity: 'critical',
  },
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[REDACTED:EMAIL]',
    severity: 'high',
  },
  {
    name: 'phone_number',
    pattern: /\b(\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g,
    replacement: '[REDACTED:PHONE]',
    severity: 'medium',
  },
  {
    name: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED:AWS_KEY]',
    severity: 'critical',
  },
];

export const REDACTED_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-access-token',
  'x-refresh-token',
  'proxy-authorization',
];
