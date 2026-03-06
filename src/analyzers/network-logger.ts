// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import { NetworkEvent } from '../types/capture';
import { SecurityRedactor } from '../security/redactor';

export class NetworkLogger {
  private events: NetworkEvent[] = [];
  private redactor: SecurityRedactor;
  private requestMap: Map<string, number> = new Map();

  constructor(redactor: SecurityRedactor) {
    this.redactor = redactor;
  }

  async attachListeners(page: Page): Promise<void> {
    page.on('request', async (request) => {
      const url = request.url();
      const startTime = Date.now();
      this.requestMap.set(url, startTime);

      const event: NetworkEvent = {
        timestamp: new Date().toISOString(),
        type: 'request',
        method: request.method(),
        url: url,
        resourceType: request.resourceType(),
        headers: { ...request.headers() },
        timing: {
          startTime,
        },
      };

      // Redact headers
      await this.redactor.redact(event.headers, 'network_request', url);

      this.events.push(event);
    });

    page.on('response', async (response) => {
      const request = response.request();
      const url = response.url();
      const endTime = Date.now();
      const startTime = this.requestMap.get(url) || endTime;
      const duration = endTime - startTime;

      const event: NetworkEvent = {
        timestamp: new Date().toISOString(),
        type: 'response',
        method: request.method(),
        url: url,
        resourceType: request.resourceType(),
        status: response.status(),
        headers: { ...response.headers() },
        timing: {
          startTime,
          endTime,
          duration,
        },
      };

      // Redact headers
      await this.redactor.redact(event.headers, 'network_response', url);

      this.events.push(event);
      this.requestMap.delete(url);
    });
  }

  getEvents(): NetworkEvent[] {
    return [...this.events];
  }

  clearEvents(): void {
    this.events = [];
  }

  getRequestCount(): number {
    return this.events.filter(e => e.type === 'request').length;
  }

  getResponseCount(): number {
    return this.events.filter(e => e.type === 'response').length;
  }
}
