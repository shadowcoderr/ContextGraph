// Developer: Shadow Coderr, Architect
import { createHash } from 'crypto';

export function generatePageId(url: string, timestamp: Date): string {
  const dateStr = timestamp
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .split('.')[0]; // 20251213_103045

  const urlHash = createHash('md5')
    .update(url)
    .digest('hex')
    .substring(0, 7); // a4b8c2d

  return `${dateStr}_${urlHash}`;
}

export function generateSessionId(timestamp: Date): string {
  return `session_${timestamp
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .split('.')[0]}`;
}
