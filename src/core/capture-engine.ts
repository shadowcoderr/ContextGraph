// Developer: Shadow Coderr, Architect
import * as crypto from 'crypto';
import { Page } from '@playwright/test';
import { Config } from '../types/config';
import { PageSnapshot } from '../types/capture';
import { DOMAnalyzer } from '../analyzers/dom-analyzer';
import { AccessibilityExtractor } from '../analyzers/a11y-extractor';
import { LocatorGenerator } from '../analyzers/locator-generator';
import { NetworkLogger } from '../analyzers/network-logger';
import { SecurityRedactor } from '../security/redactor';
import { DataValidator } from '../security/validator';
import { logger } from '../utils/logger';

export class CaptureEngine {
  private domAnalyzer: DOMAnalyzer;
  private a11yExtractor: AccessibilityExtractor;
  private locatorGenerator: LocatorGenerator;
  private networkLogger: NetworkLogger;
  private redactor: SecurityRedactor;
  private validator: DataValidator;

  constructor(config: Config) {
    this.domAnalyzer = new DOMAnalyzer();
    this.a11yExtractor = new AccessibilityExtractor();
    this.locatorGenerator = new LocatorGenerator();
    this.redactor = new SecurityRedactor(config.security.customPatterns);
    this.networkLogger = new NetworkLogger(this.redactor);
    this.validator = new DataValidator();
  }

  async attachNetworkListeners(page: Page): Promise<void> {
    await this.networkLogger.attachListeners(page);
  }

  async capturePageSnapshot(page: Page, config: Config, consoleMessages: any[] = []): Promise<PageSnapshot> {
    logger.info('Starting page capture');

    const url = page.url();
    const timestamp = new Date();
    const domain = new URL(url).hostname;

    // Capture all data in parallel where possible
    // Add timeout to prevent hanging - increased for complex pages
    const captureTimeout = 45000; // 45 seconds max per capture
    
    const captureWithTimeout = async <T>(promise: Promise<T>, name: string): Promise<T | null> => {
      try {
        return await Promise.race([
          promise,
          new Promise<T | null>((_, reject) => 
            setTimeout(() => reject(new Error(`${name} timeout`)), captureTimeout)
          )
        ]);
      } catch (error) {
        logger.warn(`${name} capture failed or timed out: ${(error as Error).message}`);
        return null;
      }
    };

    const [
      domResult,
      a11yTree,
      locators,
      performanceMetrics,
    ] = await Promise.all([
      captureWithTimeout(this.domAnalyzer.analyze(page), 'DOM'),
      config.capture.accessibility.enabled 
        ? captureWithTimeout(this.a11yExtractor.extract(page, config.capture.accessibility.includeHidden), 'A11y')
        : Promise.resolve(null),
      captureWithTimeout(this.locatorGenerator.generateLocators(page), 'Locators'),
      captureWithTimeout(this.domAnalyzer.getPerformanceMetrics(page), 'Performance'),
    ]);

    const frameContents = domResult?.frames || [];
    const frames = await this.getFrameHierarchy(page, frameContents);

    const networkEvents = this.networkLogger.getEvents();

    // Capture enhanced data
    const [pageState, networkSummary, enhancedTiming] = await Promise.all([
      captureWithTimeout(this.capturePageState(page), 'PageState'),
      captureWithTimeout(this.captureNetworkSummary(networkEvents), 'NetworkSummary'),
      captureWithTimeout(this.captureEnhancedTiming(page), 'EnhancedTiming'),
    ]);

    const metadata = {
      captureId: `${timestamp.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0]}_${domain.replace(/\./g, '_')}`,
      timestamp: timestamp.toISOString(),
      mode: 'browser' as const,
      url,
      domain,
      title: await page.title().catch(() => ''),
      viewport: {
        ...config.browser.viewport,
        deviceScaleFactor: 1,
      },
      timing: enhancedTiming || {
        navigationStart: Date.now() - 1000,
        domContentLoaded: Date.now() - 500,
        loadComplete: Date.now(),
        networkIdle: Date.now(),
      },
      performance: performanceMetrics || { domNodes: 0, scripts: 0, stylesheets: 0, images: 0, totalRequests: 0 },
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => ''),
      cookies: '[REDACTED]', // Always redact cookies
      pageName: this.generatePageName(url),
      pageState: pageState || undefined,
      networkSummary: networkSummary || undefined,
      contentHash: '', // Will be computed after snapshot is built
    };

    const snapshot: PageSnapshot = {
      metadata,
      domSnapshot: domResult?.html || '<html></html>',
      a11yTree: a11yTree || { role: 'unknown', name: '', children: [] },
      locators: await this.enhanceLocatorsData(page, locators || { elements: [] }),
      frames: frames || { url: url, name: '', children: [] },
      networkEvents,
      consoleMessages,
      screenshotPaths: [], // Placeholder
    };

    // Compute content hash for change detection
    snapshot.metadata.contentHash = this.computeContentHash(snapshot);

    // Validate the snapshot
    const validation = this.validator.validatePageSnapshot(snapshot);
    if (!validation.valid) {
      logger.warn(`Validation errors: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      logger.warn(`Validation warnings: ${validation.warnings.join(', ')}`);
    }

    logger.info('Page capture completed');
    return snapshot;
  }

  private async getFrameHierarchy(page: Page, frameContents?: Array<{ url: string; name: string; content: string }>): Promise<any> {
    // Build hierarchy and attach serialized content if available
    const frames = page.frames();

    const buildHierarchy = (frame: any): any => {
      const children = frame.childFrames().map(buildHierarchy);
      const contentEntry = (frameContents || []).find((f: any) => f.url === frame.url() && f.name === frame.name());
      return {
        url: frame.url(),
        name: frame.name(),
        children,
        content: contentEntry ? contentEntry.content : undefined,
      };
    };

    return buildHierarchy(frames[0]);
  }

  getRedactionAudit() {
    return this.redactor.getAuditLog();
  }

  private generatePageName(url: string): string {
    try {
      const u = new URL(url);
      const pathname = u.pathname.replace(/\/+$/g, ''); // strip trailing slash
      
      // Handle root/index page
      if (!pathname || pathname === '/') {
        // If there are query params, include them
        const params = Array.from(u.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        if (params.length > 0) {
          if (params.length === 1 && params[0][0] === 'id') {
            return `index-${this.sanitize(params[0][1])}`;
          }
          const paramStr = params.map(([k, v]) => `${this.sanitize(k)}-${this.sanitize(v)}`).join('-');
          return `index-${paramStr}`;
        }
        return 'index';
      }

      const segments = pathname.split('/').filter(Boolean);
      // Remove extension of last segment
      const last = segments[segments.length - 1];
      const baseLast = last.replace(/\.html?$/i, '');
      segments[segments.length - 1] = baseLast;
      let base = segments.join('-');

      // Handle query parameters
      const params = Array.from(u.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      if (params.length === 1 && params[0][0] === 'id') {
        // Special case: if only 'id' param, append just the value
        base = `${base}-${this.sanitize(params[0][1])}`;
      } else if (params.length > 0) {
        // Multiple params: include key-value pairs
        for (const [k, v] of params) {
          base = `${base}-${this.sanitize(k)}-${this.sanitize(v)}`;
        }
      }

      base = this.sanitize(base);
      return base || 'page';
    } catch (error) {
      logger.warn(`Failed to generate page name from URL: ${url}, error: ${(error as Error).message}`);
      return 'page';
    }
  }

  private sanitize(name: string): string {
    return name.replace(/[^a-z0-9\-]/gi, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '').toLowerCase();
  }

  /**
   * Compute a content hash for change detection
   * Combines DOM, accessibility tree, and locators into a single hash
   */
  private computeContentHash(snapshot: PageSnapshot): string {
    try {
      // Create a hashable representation of the page content
      const hashContent = {
        // DOM structure (normalized)
        dom: this.normalizeDomForHash(snapshot.domSnapshot),
        // Accessibility tree structure
        a11y: this.normalizeA11yForHash(snapshot.a11yTree),
        // Locator signatures (element IDs and their best locators)
        locators: snapshot.locators.elements.map(e => ({
          id: e.elementId,
          tag: e.tagName,
          role: e.attributes?.role,
          testId: e.attributes?.['data-testid'],
          text: e.text?.substring(0, 50), // Limit text length
          uniqueLocators: e.locators.filter(l => l.isUnique).map(l => l.strategy),
        })),
      };

      const hashString = JSON.stringify(hashContent, Object.keys(hashContent).sort());
      return crypto.createHash('sha256').update(hashString).digest('hex').substring(0, 16);
    } catch (error) {
      logger.warn(`Failed to compute content hash: ${(error as Error).message}`);
      return '';
    }
  }

  /**
   * Normalize DOM for hashing by removing dynamic content
   */
  private normalizeDomForHash(dom: string): string {
    // Remove scripts, styles, and dynamic attributes
    let normalized = dom
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/\s+(class|id|style)="[^"]*"/g, '') // Remove class/id/style attributes
      .replace(/\s+data-cc-element-id="[^"]*"/g, '') // Remove our own tracking attribute
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    // Limit length for performance
    return normalized.substring(0, 5000);
  }

  /**
   * Normalize accessibility tree for hashing
   */
  private normalizeA11yForHash(a11y: any): any {
    if (!a11y) return null;
    
    return {
      role: a11y.role,
      name: a11y.name?.substring(0, 50),
      children: a11y.children?.map((c: any) => this.normalizeA11yForHash(c)),
    };
  }

  /**
   * Capture page state information
   */
  private async capturePageState(page: Page): Promise<any> {
    try {
      return await page.evaluate(() => {
        const activeElement = document.activeElement;
        const focusedElement = activeElement ? 
          (activeElement.id ? `#${activeElement.id}` : 
           activeElement.className ? `.${activeElement.className.split(' ')[0]}` :
           activeElement.tagName.toLowerCase()) : undefined;

        const selectedText = window.getSelection()?.toString() || '';

        // Capture form data (redacted)
        const formData: Record<string, any> = {};
        const forms = document.querySelectorAll('form');
        forms.forEach((form, idx) => {
          const formId = form.id || `form_${idx}`;
          const inputs: Record<string, any> = {};
          form.querySelectorAll('input, select, textarea').forEach((input: any) => {
            const name = input.name || input.id || `input_${idx}`;
            if (input.type === 'checkbox' || input.type === 'radio') {
              inputs[name] = input.checked;
            } else if (input.type === 'password') {
              inputs[name] = '[REDACTED]';
            } else {
              inputs[name] = input.value ? '[REDACTED]' : '';
            }
          });
          if (Object.keys(inputs).length > 0) {
            formData[formId] = inputs;
          }
        });

        // Capture storage keys (not values)
        const localStorageKeys: Record<string, string> = {};
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key) localStorageKeys[key] = '[REDACTED]';
          }
        } catch {}

        const sessionStorageKeys: Record<string, string> = {};
        try {
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i);
            if (key) sessionStorageKeys[key] = '[REDACTED]';
          }
        } catch {}

        return {
          scrollPosition: { x: window.scrollX, y: window.scrollY },
          focusedElement,
          selectedText,
          formData: Object.keys(formData).length > 0 ? formData : undefined,
          localStorage: Object.keys(localStorageKeys).length > 0 ? localStorageKeys : undefined,
          sessionStorage: Object.keys(sessionStorageKeys).length > 0 ? sessionStorageKeys : undefined,
        };
      });
    } catch (error) {
      logger.warn('Failed to capture page state: ' + (error as Error).message);
      return null;
    }
  }

  /**
   * Capture network request summary
   */
  private async captureNetworkSummary(networkEvents: any[]): Promise<any> {
    try {
      const requestTypes: Record<string, number> = {};
      const apiEndpoints: string[] = [];
      let failedRequests = 0;

      for (const event of networkEvents) {
        // Count by resource type
        const type = event.resourceType || 'other';
        requestTypes[type] = (requestTypes[type] || 0) + 1;

        // Track failed requests
        if (event.type === 'response' && event.status && (event.status < 200 || event.status >= 400)) {
          failedRequests++;
        }

        // Extract API endpoints (XHR/Fetch to same domain or API-like URLs)
        if ((type === 'xhr' || type === 'fetch') && event.url) {
          try {
            const url = new URL(event.url);
            const path = url.pathname;
            if (path.startsWith('/api/') || path.includes('/api/') || 
                event.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)) {
              if (!apiEndpoints.includes(path)) {
                apiEndpoints.push(path);
              }
            }
          } catch {}
        }
      }

      return {
        totalRequests: networkEvents.length,
        failedRequests,
        requestTypes,
        apiEndpoints: apiEndpoints.slice(0, 20), // Limit to 20 endpoints
      };
    } catch (error) {
      logger.warn('Failed to capture network summary: ' + (error as Error).message);
      return null;
    }
  }

  /**
   * Capture enhanced timing metrics
   */
  private async captureEnhancedTiming(page: Page): Promise<any> {
    try {
      const timing = await page.evaluate(() => {
        const perf = window.performance;
        const navTiming = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const paintTiming = perf.getEntriesByType('paint');
        
        const fcp = paintTiming.find((entry: any) => entry.name === 'first-contentful-paint');
        const lcp = perf.getEntriesByType('largest-contentful-paint');
        const lcpEntry = lcp.length > 0 ? lcp[lcp.length - 1] : null;

        return {
          navigationStart: navTiming ? (navTiming as any).navigationStart || navTiming.fetchStart : Date.now() - 1000,
          domContentLoaded: navTiming ? navTiming.domContentLoadedEventEnd : Date.now() - 500,
          loadComplete: navTiming ? navTiming.loadEventEnd : Date.now(),
          networkIdle: Date.now(),
          firstContentfulPaint: fcp ? (fcp as any).startTime : undefined,
          largestContentfulPaint: lcpEntry ? (lcpEntry as any).renderTime || (lcpEntry as any).loadTime : undefined,
          timeToInteractive: navTiming ? navTiming.domInteractive : undefined,
        };
      });

      return timing;
    } catch (error) {
      logger.warn('Failed to capture enhanced timing: ' + (error as Error).message);
      return null;
    }
  }

  /**
   * Enhance locators data with CSS styles, viewport info, and form details
   */
  private async enhanceLocatorsData(page: Page, locatorsData: any): Promise<any> {
    try {
      // Build element selector map for efficient lookup
      const elementMap = new Map<string, string>();
      for (const element of locatorsData.elements) {
        // Create selector from element attributes
        let selector = '';
        if (element.attributes?.id) {
          selector = `#${element.attributes.id}`;
        } else if (element.attributes?.['data-test']) {
          selector = `[data-test="${element.attributes['data-test']}"]`;
        } else if (element.attributes?.['data-testid']) {
          selector = `[data-testid="${element.attributes['data-testid']}"]`;
        } else if (element.position && element.position.x >= 0 && element.position.y >= 0) {
          // Use position as fallback - find element at this position
          selector = `[data-cc-element-id="${element.elementId}"]`;
        }
        if (selector) {
          elementMap.set(element.elementId, selector);
        }
      }

      // Enhance elements with styles and viewport info
      const enhancedElements = await Promise.all(
        locatorsData.elements.map(async (element: any) => {
          try {
            const selector = elementMap.get(element.elementId);
            if (!selector) return element;

            // Get CSS styles and viewport info in one call
            const enhancement = await page.evaluate(({ sel, pos }: { sel: string; pos: any }) => {
              let el: Element | null = null;
              
              // Try to find element by selector
              try {
                el = document.querySelector(sel);
              } catch {}
              
              // Fallback: find by position if selector fails
              if (!el && pos && pos.x >= 0 && pos.y >= 0) {
                el = document.elementFromPoint(pos.x, pos.y);
              }
              
              if (!el) return null;

              const computed = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              
              return {
                styles: {
                  display: computed.display,
                  visibility: computed.visibility,
                  opacity: computed.opacity,
                  zIndex: computed.zIndex,
                  position: computed.position,
                  backgroundColor: computed.backgroundColor !== 'rgba(0, 0, 0, 0)' && computed.backgroundColor !== 'transparent' ? computed.backgroundColor : undefined,
                  color: computed.color,
                  fontSize: computed.fontSize,
                  fontWeight: computed.fontWeight,
                  border: computed.border !== '0px none rgb(0, 0, 0)' ? computed.border : undefined,
                  borderRadius: computed.borderRadius !== '0px' ? computed.borderRadius : undefined,
                },
                viewportInfo: {
                  visible: rect.width > 0 && rect.height > 0,
                  inViewport: rect.top >= 0 && rect.left >= 0 && 
                             rect.bottom <= window.innerHeight && 
                             rect.right <= window.innerWidth,
                  viewportPosition: { x: rect.left, y: rect.top },
                },
              };
            }, { sel: selector, pos: element.position }).catch(() => null);

            if (enhancement) {
              return {
                ...element,
                styles: enhancement.styles,
                viewportInfo: enhancement.viewportInfo,
              };
            }
            return element;
          } catch (error) {
            return element;
          }
        })
      );

      // Extract form field details
      const formFields = await this.captureFormFieldDetails(page, locatorsData.elements);

      // Build viewport elements list
      const viewportElements = enhancedElements
        .filter((el: any) => el.viewportInfo?.inViewport)
        .map((el: any) => ({
          elementId: el.elementId,
          visible: el.viewportInfo?.visible || false,
          inViewport: el.viewportInfo?.inViewport || false,
          viewportPosition: el.viewportInfo?.viewportPosition || { x: 0, y: 0 },
        }));

      return {
        elements: enhancedElements,
        viewportElements: viewportElements.length > 0 ? viewportElements : undefined,
        formFields: formFields.length > 0 ? formFields : undefined,
      };
    } catch (error) {
      logger.warn('Failed to enhance locators data: ' + (error as Error).message);
      return locatorsData;
    }
  }

  /**
   * Capture form field details
   */
  private async captureFormFieldDetails(page: Page, elements: any[]): Promise<any[]> {
    try {
      const formFields: any[] = [];

      for (const element of elements) {
        const tagName = element.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
          try {
            // Build selector from element attributes
            let selector = '';
            if (element.attributes?.id) {
              selector = `#${element.attributes.id}`;
            } else if (element.attributes?.['data-test']) {
              selector = `[data-test="${element.attributes['data-test']}"]`;
            } else if (element.attributes?.['data-testid']) {
              selector = `[data-testid="${element.attributes['data-testid']}"]`;
            } else if (element.attributes?.name) {
              selector = `${tagName}[name="${element.attributes.name}"]`;
            }

            if (!selector) continue;

            const details = await page.evaluate(({ sel, tag }: { sel: string; tag: string }) => {
              const el = document.querySelector(sel) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
              if (!el) return null;

              // Get label
              let label: string | undefined;
              if (el.id) {
                const labelEl = document.querySelector(`label[for="${el.id}"]`);
                label = labelEl?.textContent?.trim();
              }
              if (!label && el.closest('label')) {
                label = el.closest('label')?.textContent?.trim();
              }

              return {
                fieldType: (el as HTMLInputElement).type || tag,
                label,
                placeholder: (el as HTMLInputElement).placeholder || undefined,
                required: el.hasAttribute('required'),
                pattern: (el as HTMLInputElement).pattern || undefined,
                maxLength: (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : undefined,
                minLength: (el as HTMLInputElement).minLength > 0 ? (el as HTMLInputElement).minLength : undefined,
                validationRules: {
                  required: el.hasAttribute('required'),
                  pattern: (el as HTMLInputElement).pattern || undefined,
                  maxLength: (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : undefined,
                  minLength: (el as HTMLInputElement).minLength > 0 ? (el as HTMLInputElement).minLength : undefined,
                },
              };
            }, { sel: selector, tag: tagName }).catch(() => null);

            if (details) {
              formFields.push({
                elementId: element.elementId,
                ...details,
              });
            }
          } catch (error) {
            // Skip this element
          }
        }
      }

      return formFields;
    } catch (error) {
      logger.warn('Failed to capture form field details: ' + (error as Error).message);
      return [];
    }
  }
}
