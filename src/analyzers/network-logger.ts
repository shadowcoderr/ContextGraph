// Developer: Shadow Coderr, Architect
import { Page, Request, Response } from '@playwright/test';
import { NetworkEvent } from '../types/capture';
import { SecurityRedactor } from '../security/redactor';
import { logger } from '../utils/logger';

export interface NetworkLoggerOptions {
  captureHeaders: boolean;
  captureBody: boolean;
  /** Maximum response body size to capture, in bytes (default 2048) */
  maxBodySize: number;
  /** Resource types to skip entirely (e.g. images, fonts) */
  skipResourceTypes: string[];
}

const DEFAULT_OPTIONS: NetworkLoggerOptions = {
  captureHeaders: true,
  captureBody: false,
  maxBodySize: 2048,
  skipResourceTypes: ['image', 'font', 'media'],
};

export class NetworkLogger {
  private events: NetworkEvent[] = [];
  private redactor: SecurityRedactor;
  private options: NetworkLoggerOptions;

  /**
   * WeakMap keyed on the Playwright Request object guarantees O(1) access and
   * zero URL collision — even when the same URL is requested concurrently.
   * The Request object is the *same reference* in both the 'request' listener
   * and the `response.request()` call, so this is safe.
   */
  private requestTimes = new WeakMap<Request, number>();

  constructor(redactor: SecurityRedactor, options?: Partial<NetworkLoggerOptions>) {
    this.redactor = redactor;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async attachListeners(page: Page): Promise<void> {
    // ── Outgoing request ──────────────────────────────────────────────────────
    page.on('request', async (request: Request) => {
      try {
        if (this.options.skipResourceTypes.includes(request.resourceType())) return;

        this.requestTimes.set(request, Date.now());

        const sanitizedUrl = this.redactor.sanitizeUrl(request.url());
        const headers = this.options.captureHeaders ? { ...request.headers() } : {};

        if (this.options.captureHeaders) {
          await this.redactor.redact(headers, 'network_request', sanitizedUrl).catch(() => {});
        }

        const event: NetworkEvent = {
          timestamp: new Date().toISOString(),
          type: 'request',
          method: request.method(),
          url: sanitizedUrl,
          resourceType: request.resourceType(),
          headers,
          timing: { startTime: Date.now() },
        };

        this.events.push(event);
      } catch (error) {
        logger.debug(`NetworkLogger request handler error: ${(error as Error).message}`);
      }
    });

    // ── Response received ─────────────────────────────────────────────────────
    page.on('response', async (response: Response) => {
      try {
        const request = response.request();
        if (this.options.skipResourceTypes.includes(request.resourceType())) return;

        const endTime = Date.now();
        const startTime = this.requestTimes.get(request) ?? endTime;
        const duration = endTime - startTime;
        // Do NOT delete from WeakMap — GC handles cleanup automatically

        const sanitizedUrl = this.redactor.sanitizeUrl(response.url());
        const headers = this.options.captureHeaders ? { ...response.headers() } : {};

        if (this.options.captureHeaders) {
          await this.redactor.redact(headers, 'network_response', sanitizedUrl).catch(() => {});
        }

        const event: NetworkEvent = {
          timestamp: new Date().toISOString(),
          type: 'response',
          method: request.method(),
          url: sanitizedUrl,
          resourceType: request.resourceType(),
          status: response.status(),
          headers,
          timing: { startTime, endTime, duration },
        };

        // Capture response body if enabled and content type is text/JSON
        if (this.options.captureBody) {
          const contentType = response.headers()['content-type'] ?? '';
          const isText =
            contentType.includes('json') ||
            contentType.includes('text/') ||
            contentType.includes('xml');

          if (isText) {
            try {
              const rawBody = await response.text();
              if (rawBody) {
                const bodyObj = { body: rawBody.substring(0, this.options.maxBodySize) };
                await this.redactor.redact(bodyObj, 'response_body', sanitizedUrl).catch(() => {});
                event.body = bodyObj.body;
              }
            } catch {
              // Body may not be readable (e.g. already consumed); skip silently
            }
          }
        }

        this.events.push(event);
      } catch (error) {
        logger.debug(`NetworkLogger response handler error: ${(error as Error).message}`);
      }
    });

    // ── Failed request — captured as type 'failed' ────────────────────────────
    page.on('requestfailed', async (request: Request) => {
      try {
        if (this.options.skipResourceTypes.includes(request.resourceType())) return;

        const endTime = Date.now();
        const startTime = this.requestTimes.get(request) ?? endTime;
        const sanitizedUrl = this.redactor.sanitizeUrl(request.url());

        const event: NetworkEvent = {
          timestamp: new Date().toISOString(),
          type: 'failed' as any,
          method: request.method(),
          url: sanitizedUrl,
          resourceType: request.resourceType(),
          failureReason: request.failure()?.errorText ?? 'Unknown failure',
          timing: { startTime, endTime, duration: endTime - startTime },
          headers: {},
        } as NetworkEvent & { failureReason?: string };

        this.events.push(event);
        logger.debug(`Network request failed: ${request.method()} ${sanitizedUrl} — ${(event as any).failureReason}`);
      } catch (error) {
        logger.debug(`NetworkLogger requestfailed handler error: ${(error as Error).message}`);
      }
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

  getFailedCount(): number {
    return this.events.filter(e => (e as any).type === 'failed').length;
  }

  /** Returns only XHR/Fetch events — useful for API surface analysis */
  getApiEvents(): NetworkEvent[] {
    return this.events.filter(
      e => e.resourceType === 'xhr' || e.resourceType === 'fetch'
    );
  }
}
