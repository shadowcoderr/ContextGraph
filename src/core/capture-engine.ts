// Developer: Shadow Coderr, Architect
import * as crypto from 'crypto';
import { Page } from '@playwright/test';
import { Config } from '../types/config';
import { PageSnapshot } from '../types/capture';
import { DOMAnalyzer } from '../analyzers/dom-analyzer';
import { AccessibilityExtractor } from '../analyzers/a11y-extractor';
import { LocatorGenerator } from '../analyzers/locator-generator';
import { NetworkLogger } from '../analyzers/network-logger';
import { ScreenshotCapturer } from '../analyzers/screenshot-capturer';
import { SecurityRedactor } from '../security/redactor';
import { DataValidator } from '../security/validator';
import { logger } from '../utils/logger';

export class CaptureEngine {
  private domAnalyzer: DOMAnalyzer;
  private a11yExtractor: AccessibilityExtractor;
  private locatorGenerator: LocatorGenerator;
  private networkLogger: NetworkLogger;
  private screenshotCapturer: ScreenshotCapturer;
  private redactor: SecurityRedactor;
  private validator: DataValidator;

  constructor(config: Config) {
    this.domAnalyzer = new DOMAnalyzer();
    this.a11yExtractor = new AccessibilityExtractor();
    this.locatorGenerator = new LocatorGenerator();
    this.redactor = new SecurityRedactor(config.security.customPatterns);
    this.networkLogger = new NetworkLogger(this.redactor, {
      captureHeaders: config.capture.network.captureHeaders,
      captureBody: config.capture.network.captureBody,
    });
    this.screenshotCapturer = new ScreenshotCapturer({
      fullPage: config.capture.screenshots.fullPage,
      elementTargeting: config.capture.screenshots.elementTargeting,
    });
    this.validator = new DataValidator();
  }

  async attachNetworkListeners(page: Page): Promise<void> {
    await this.networkLogger.attachListeners(page);
  }

  /**
   * Capture a full snapshot of the current page state.
   *
   * @param page            — Playwright Page instance
   * @param config          — Active configuration
   * @param consoleMessages — Console messages buffered by BrowserAdapter
   * @param pageDir         — If provided, full-page screenshots are captured here.
   *                          The caller is responsible for ensuring the directory
   *                          exists before passing this parameter.
   */
  async capturePageSnapshot(
    page: Page,
    config: Config,
    consoleMessages: any[] = [],
    outputDir: string,
  ): Promise<PageSnapshot> {
    // Ensure proper viewport is set before capture
    await page.setViewportSize({
      width: config.browser.viewport.width,
      height: config.browser.viewport.height,
    });
    logger.info('Starting page capture');

    const url = page.url();
    const timestamp = new Date();
    const domain = new URL(url).hostname;

    const CAPTURE_TIMEOUT = 45_000;

    const captureWithTimeout = async <T>(
      promise: Promise<T>,
      name: string
    ): Promise<T | null> => {
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${name} capture timed out`)), CAPTURE_TIMEOUT)
          ),
        ]);
      } catch (error) {
        logger.warn(`${name} capture failed: ${(error as Error).message}`);
        return null;
      }
    };

    // ── Primary captures (run in parallel) ─────────────────────────────────────
    const [domResult, a11yTree, locators, performanceMetrics] = await Promise.all([
      captureWithTimeout(this.domAnalyzer.analyze(page), 'DOM'),
      config.capture.accessibility.enabled
        ? captureWithTimeout(
            this.a11yExtractor.extract(page, config.capture.accessibility.includeHidden),
            'A11y'
          )
        : Promise.resolve(null),
      captureWithTimeout(this.locatorGenerator.generateLocators(page), 'Locators'),
      captureWithTimeout(this.domAnalyzer.getPerformanceMetrics(page), 'Performance'),
    ]);

    const frameContents = domResult?.frames || [];
    const frames = await captureWithTimeout(
      this.getFrameHierarchy(page, frameContents),
      'Frames'
    );

    const networkEvents = this.networkLogger.getEvents();

    // ── Secondary captures ─────────────────────────────────────────────────────
    const [pageState, networkSummary, enhancedTiming] = await Promise.all([
      captureWithTimeout(this.capturePageState(page), 'PageState'),
      captureWithTimeout(this.captureNetworkSummary(networkEvents), 'NetworkSummary'),
      captureWithTimeout(this.captureEnhancedTiming(page), 'EnhancedTiming'),
    ]);

    const metadata = {
      captureId: `${timestamp
        .toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .split('.')[0]}_${domain.replace(/\./g, '_')}`,
      timestamp: timestamp.toISOString(),
      mode: 'browser' as const,
      url,
      domain,
      title: await page.title().catch(() => ''),
      viewport: { ...config.browser.viewport, deviceScaleFactor: 1 },
      timing: enhancedTiming || {
        navigationStart: Date.now() - 1000,
        domContentLoaded: Date.now() - 500,
        loadComplete: Date.now(),
        networkIdle: Date.now(),
      },
      performance: performanceMetrics || {
        domNodes: 0, scripts: 0, stylesheets: 0, images: 0, totalRequests: 0,
      },
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => ''),
      cookies: '[REDACTED]',
      pageName: this.generatePageName(url),
      pageState: pageState || undefined,
      networkSummary: networkSummary || undefined,
      contentHash: '',
    };

    const enhancedLocators = await captureWithTimeout(
      this.enhanceLocatorsData(page, locators || { elements: [] }),
      'EnhancedLocators'
    );

    const snapshot: PageSnapshot = {
      metadata,
      domSnapshot: domResult?.html || '<html></html>',
      a11yTree: a11yTree || { role: 'unknown', name: '', children: [] },
      locators: enhancedLocators || { elements: [] },
      frames: frames || { url, name: '', children: [] },
      networkEvents,
      consoleMessages,
      screenshotPaths: [],
    };

    // ── Content hash (structural fingerprint) ───────────────────────────────────
    snapshot.metadata.contentHash = this.computeContentHash(snapshot);

    // ── Screenshots (only if caller provided a page directory) ─────────────────
    if (config.capture.screenshots.enabled && outputDir) {
      try {
        const elementTargets = config.capture.screenshots.elementTargeting
          ? ScreenshotCapturer.buildElementTargets(snapshot.locators.elements || [])
          : [];

        const screenshotResult = await captureWithTimeout(
          this.screenshotCapturer.capturePageScreenshots(
            page,
            outputDir,
            snapshot.metadata.captureId,
            elementTargets
          ),
          'Screenshots'
        );

        if (screenshotResult?.fullPagePath) {
          snapshot.screenshotPaths = [screenshotResult.fullPagePath];
          if (screenshotResult.elementPaths.length > 0) {
            snapshot.screenshotPaths.push(
              ...screenshotResult.elementPaths.map(e => e.path)
            );
          }
        }
      } catch (error) {
        logger.warn(`Screenshot capture failed: ${(error as Error).message}`);
      }
    }

    // ── Validation ─────────────────────────────────────────────────────────────
    const validation = this.validator.validatePageSnapshot(snapshot);
    if (!validation.valid) logger.warn(`Validation errors: ${validation.errors.join(', ')}`);
    if (validation.warnings.length > 0)
      logger.warn(`Validation warnings: ${validation.warnings.join(', ')}`);

    logger.info('Page capture completed');
    return snapshot;
  }

  // ── Frame hierarchy ─────────────────────────────────────────────────────────

  private async getFrameHierarchy(
    page: Page,
    frameContents: Array<{ url: string; name: string; content: string }> = []
  ): Promise<any> {
    const frames = page.frames();

    const buildHierarchy = (frame: any): any => {
      const contentEntry = frameContents.find(
        f => f.url === frame.url() && f.name === frame.name()
      );
      return {
        url: frame.url(),
        name: frame.name(),
        children: frame.childFrames().map(buildHierarchy),
        content: contentEntry?.content,
      };
    };

    return buildHierarchy(frames[0]);
  }

  // ── Content hash ────────────────────────────────────────────────────────────

  /**
   * Compute a structural fingerprint of the page for change detection.
   *
   * Instead of truncating the raw HTML at 5 000 chars (which causes SPAs with
   * large identical `<head>` sections to hash identically across routes), we
   * extract a token stream of `tagName[#id][@role]` from the DOM.  This is
   * order-sensitive, compact, and captures the semantic structure without
   * being affected by text-content changes that don't alter layout.
   */
  private computeContentHash(snapshot: PageSnapshot): string {
    try {
      const hashContent = {
        domStructure: this.normalizeDomForHash(snapshot.domSnapshot),
        a11yStructure: this.normalizeA11yForHash(snapshot.a11yTree),
        locatorSignatures: (snapshot.locators.elements || []).map(e => ({
          id: e.elementId,
          tag: e.tagName,
          role: e.attributes?.role,
          testId: e.attributes?.['data-testid'],
          text: e.text?.substring(0, 50),
          uniqueStrategies: e.locators.filter(l => l.isUnique).map(l => l.strategy),
        })),
      };

      const hashString = JSON.stringify(hashContent);
      return crypto.createHash('sha256').update(hashString).digest('hex').substring(0, 16);
    } catch (error) {
      logger.warn(`Failed to compute content hash: ${(error as Error).message}`);
      return '';
    }
  }

  /**
   * Extract a structural token stream from HTML rather than truncating text.
   * Produces strings like `div#app@main|button|input@textbox` — semantically
   * rich but immune to text-content noise and `<head>` boilerplate.
   *
   * Up to 500 tokens are extracted to bound memory usage while covering
   * enough of the page to reliably detect structural changes.
   */
  private normalizeDomForHash(dom: string): string {
    const tagPattern = /<([a-z][a-z0-9]*)[^>]*?(?:\sid="([^"]*)")?[^>]*?(?:\srole="([^"]*)")?[^>]*/gi;
    const tokens: string[] = [];
    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = tagPattern.exec(dom)) !== null && count < 500) {
      const tag = match[1];
      const id = match[2] ? `#${match[2]}` : '';
      const role = match[3] ? `@${match[3]}` : '';
      tokens.push(`${tag}${id}${role}`);
      count++;
    }

    return tokens.join('|');
  }

  private normalizeA11yForHash(a11y: any): any {
    if (!a11y) return null;
    return {
      role: a11y.role,
      name: a11y.name?.substring(0, 50),
      children: a11y.children?.slice(0, 20).map((c: any) => this.normalizeA11yForHash(c)),
    };
  }

  // ── Page name ───────────────────────────────────────────────────────────────

  private generatePageName(url: string): string {
    try {
      const u = new URL(url);
      const pathname = u.pathname.replace(/\/+$/, '');

      let pageName = 'index';
      if (pathname && pathname !== '/') {
        const segments = pathname.split('/').filter(Boolean);
        segments[segments.length - 1] = segments[segments.length - 1].replace(/\.html?$/i, '');
        pageName = segments.join('-');
      }

      const params = Array.from(u.searchParams.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      );

      if (params.length > 0) {
        if (params.length === 1 && params[0][0] === 'id') {
          pageName = `${pageName}-${this.sanitizeName(params[0][1])}`;
        } else {
          const paramStr = params
            .map(([k, v]) => `${this.sanitizeName(k)}-${this.sanitizeName(v)}`)
            .join('-');
          pageName = `${pageName}-${paramStr}`;
        }
      }

      const sanitized = this.sanitizeName(pageName) || 'page';
      
      // Limit length to avoid ENOENT on long URLs (Windows limit is 260, but let's be safe with folder names)
      if (sanitized.length > 100) {
        const hash = crypto.createHash('md5').update(sanitized).digest('hex').substring(0, 8);
        return sanitized.substring(0, 90) + '-' + hash;
      }
      
      return sanitized;
    } catch (error) {
      logger.warn(`Failed to generate page name from URL: ${url}`);
      return 'page-' + crypto.randomBytes(4).toString('hex');
    }
  }

  private sanitizeName(name: string): string {
    return name
      .replace(/[^a-z0-9\-]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '')
      .toLowerCase();
  }

  // ── Page state ──────────────────────────────────────────────────────────────

  private async capturePageState(page: Page): Promise<any> {
    try {
      return await page.evaluate(() => {
        const activeEl = document.activeElement;
        const focusedElement = activeEl
          ? activeEl.id
            ? `#${activeEl.id}`
            : activeEl.className
            ? `.${activeEl.className.split(' ')[0]}`
            : activeEl.tagName.toLowerCase()
          : undefined;

        const selectedText = window.getSelection()?.toString() || '';

        const formData: Record<string, any> = {};
        document.querySelectorAll('form').forEach((form, idx) => {
          const formId = form.id || `form_${idx}`;
          const inputs: Record<string, any> = {};
          form.querySelectorAll('input, select, textarea').forEach((el: any) => {
            const name = el.name || el.id || `input_${idx}`;
            if (el.type === 'checkbox' || el.type === 'radio') inputs[name] = el.checked;
            else if (el.type === 'password') inputs[name] = '[REDACTED]';
            else inputs[name] = el.value ? '[REDACTED]' : '';
          });
          if (Object.keys(inputs).length > 0) formData[formId] = inputs;
        });

        const localStorageKeys: Record<string, string> = {};
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k) localStorageKeys[k] = '[REDACTED]';
          }
        } catch { /* private browsing / security */ }

        const sessionStorageKeys: Record<string, string> = {};
        try {
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const k = window.sessionStorage.key(i);
            if (k) sessionStorageKeys[k] = '[REDACTED]';
          }
        } catch { /* private browsing / security */ }

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

  // ── Network summary ─────────────────────────────────────────────────────────

  private async captureNetworkSummary(networkEvents: any[]): Promise<any> {
    try {
      const requestTypes: Record<string, number> = {};
      const apiEndpoints: string[] = [];
      let failedRequests = 0;

      for (const event of networkEvents) {
        const type = event.resourceType || 'other';
        requestTypes[type] = (requestTypes[type] || 0) + 1;

        if (
          event.type === 'response' &&
          event.status &&
          (event.status < 200 || event.status >= 400)
        ) {
          failedRequests++;
        }

        if ((type === 'xhr' || type === 'fetch') && event.url) {
          try {
            const p = new URL(event.url).pathname;
            if (!apiEndpoints.includes(p)) apiEndpoints.push(p);
          } catch { /* non-parseable URL */ }
        }
      }

      return {
        totalRequests: networkEvents.length,
        failedRequests,
        requestTypes,
        apiEndpoints: apiEndpoints.slice(0, 20),
      };
    } catch (error) {
      logger.warn('Failed to capture network summary: ' + (error as Error).message);
      return null;
    }
  }

  // ── Enhanced timing ─────────────────────────────────────────────────────────

  private async captureEnhancedTiming(page: Page): Promise<any> {
    try {
      return await page.evaluate(() => {
        const perf = window.performance;
        const nav = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const paint = perf.getEntriesByType('paint');
        const fcp = paint.find((e: any) => e.name === 'first-contentful-paint');
        const lcpEntries = perf.getEntriesByType('largest-contentful-paint');
        const lcp = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null;

        return {
          navigationStart: nav ? nav.fetchStart : Date.now() - 1000,
          domContentLoaded: nav ? nav.domContentLoadedEventEnd : Date.now() - 500,
          loadComplete: nav ? nav.loadEventEnd : Date.now(),
          networkIdle: Date.now(),
          firstContentfulPaint: fcp ? (fcp as any).startTime : undefined,
          largestContentfulPaint: lcp
            ? (lcp as any).renderTime || (lcp as any).loadTime
            : undefined,
          timeToInteractive: nav ? nav.domInteractive : undefined,
        };
      });
    } catch (error) {
      logger.warn('Failed to capture enhanced timing: ' + (error as Error).message);
      return null;
    }
  }

  // ── Locator enhancement ─────────────────────────────────────────────────────

  private async enhanceLocatorsData(page: Page, locatorsData: any): Promise<any> {
    try {
      const elementMap = new Map<string, string>();

      for (const element of locatorsData.elements) {
        let selector = '';
        if (element.attributes?.id) {
          selector = `#${element.attributes.id}`;
        } else if (element.attributes?.['data-testid']) {
          selector = `[data-testid="${element.attributes['data-testid']}"]`;
        } else if (element.attributes?.['data-test']) {
          selector = `[data-test="${element.attributes['data-test']}"]`;
        } else {
          selector = `[data-cc-element-id="${element.elementId}"]`;
        }
        if (selector) elementMap.set(element.elementId, selector);
      }

      const enhancedElements = await Promise.all(
        locatorsData.elements.map(async (element: any) => {
          try {
            const selector = elementMap.get(element.elementId);
            if (!selector) return element;

            const enhancement = await page
              .evaluate(
                ({ sel, pos }: { sel: string; pos: any }) => {
                  let el: Element | null = null;
                  try { el = document.querySelector(sel); } catch { /* invalid selector */ }

                  // Positional fallback when selector fails (e.g. complex CSS)
                  if (!el && pos?.x >= 0 && pos?.y >= 0) {
                    el = document.elementFromPoint(pos.x + 1, pos.y + 1);
                  }

                  if (!el) return null;

                  const computed = window.getComputedStyle(el);
                  const rect = el.getBoundingClientRect();
                  const inViewport =
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth);

                  return {
                    styles: {
                      display: computed.display,
                      visibility: computed.visibility,
                      opacity: computed.opacity,
                      zIndex: computed.zIndex,
                      position: computed.position,
                      backgroundColor:
                        computed.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                        computed.backgroundColor !== 'transparent'
                          ? computed.backgroundColor
                          : undefined,
                      color: computed.color,
                      fontSize: computed.fontSize,
                      fontWeight: computed.fontWeight,
                    },
                    viewportInfo: {
                      visible: rect.width > 0 && rect.height > 0 && computed.visibility !== 'hidden' && computed.display !== 'none',
                      inViewport,
                      viewportPosition: { x: Math.round(rect.left), y: Math.round(rect.top) },
                    },
                    // Update bounding box with fresh data
                    position: {
                      x: Math.round(rect.left),
                      y: Math.round(rect.top),
                      width: Math.round(rect.width),
                      height: Math.round(rect.height),
                    },
                  };
                },
                { sel: selector, pos: element.position }
              )
              .catch(() => null);

            if (enhancement) {
              return {
                ...element,
                styles: enhancement.styles,
                viewportInfo: enhancement.viewportInfo,
                // Overwrite stale position data with fresh bounding box
                position: enhancement.position ?? element.position,
                computedState: {
                  ...element.computedState,
                  isVisible: enhancement.viewportInfo.visible,
                },
              };
            }
            return element;
          } catch {
            return element;
          }
        })
      );

      const viewportElements = enhancedElements
        .filter((el: any) => el.viewportInfo?.inViewport)
        .map((el: any) => ({
          elementId: el.elementId,
          visible: el.viewportInfo.visible,
          inViewport: el.viewportInfo.inViewport,
          viewportPosition: el.viewportInfo.viewportPosition,
        }));

      const formFields = await this.captureFormFieldDetails(page, locatorsData.elements);

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

  private async captureFormFieldDetails(page: Page, elements: any[]): Promise<any[]> {
    const formFields: any[] = [];

    for (const element of elements) {
      const tagName = element.tagName?.toLowerCase();
      if (!['input', 'select', 'textarea'].includes(tagName)) continue;

      try {
        let selector = '';
        if (element.attributes?.id) selector = `#${element.attributes.id}`;
        else if (element.attributes?.['data-testid'])
          selector = `[data-testid="${element.attributes['data-testid']}"]`;
        else if (element.attributes?.name)
          selector = `${tagName}[name="${element.attributes.name}"]`;
        else continue;

        const details = await page
          .evaluate(
            ({ sel, tag }: { sel: string; tag: string }) => {
              const el = document.querySelector(sel) as HTMLInputElement | null;
              if (!el) return null;

              let label: string | undefined;
              if (el.id) {
                label = document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim();
              }
              if (!label) {
                label = el.closest('label')?.textContent?.trim();
              }

              return {
                fieldType: (el as HTMLInputElement).type || tag,
                label,
                placeholder: (el as HTMLInputElement).placeholder || undefined,
                required: el.hasAttribute('required'),
                pattern: (el as HTMLInputElement).pattern || undefined,
                maxLength:
                  (el as HTMLInputElement).maxLength > 0
                    ? (el as HTMLInputElement).maxLength
                    : undefined,
                minLength:
                  (el as HTMLInputElement).minLength > 0
                    ? (el as HTMLInputElement).minLength
                    : undefined,
              };
            },
            { sel: selector, tag: tagName }
          )
          .catch(() => null);

        if (details) {
          formFields.push({ elementId: element.elementId, ...details });
        }
      } catch { /* skip this element */ }
    }

    return formFields;
  }

  // ── Redaction audit ─────────────────────────────────────────────────────────

  getRedactionAudit() {
    return this.redactor.getAuditLog();
  }

  /** Network event count — passed to StorageEngine for statistics */
  getNetworkEventCount(): number {
    return this.networkLogger.getRequestCount();
  }
}
