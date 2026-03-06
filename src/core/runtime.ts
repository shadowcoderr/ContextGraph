// Developer: Shadow Coderr, Architect
import { Browser, Page, expect } from '@playwright/test';
import { Config } from '../types/config';
import { BrowserAdapter } from './browser-adapter';
import { CaptureEngine } from './capture-engine';
import { StorageEngine } from '../storage/engine';
import { ComponentsRegistryManager } from '../registry/components-registry';
import { generateSessionId } from '../utils/hash';
import { logger } from '../utils/logger';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export enum RuntimeMode {
  BROWSER = 'browser',
  RECORDER = 'recorder',
}

export type StartRecorderOptions = {
  captureArtifacts?: boolean;
};

export class RuntimeController {
  private config: Config;
  private mode: RuntimeMode;
  private browserAdapter: BrowserAdapter;
  private captureEngine: CaptureEngine;
  private storageEngine: StorageEngine;
  private componentsRegistry: ComponentsRegistryManager | null = null;

  private sessionId: string;
  private capturedPages: Set<string> = new Set();
  private pendingCaptures: Set<Promise<void>> = new Set();

  constructor(config: Config, mode: RuntimeMode) {
    this.config = config;
    this.mode = mode;
    this.browserAdapter = new BrowserAdapter();
    this.captureEngine = new CaptureEngine(config);
    this.storageEngine = new StorageEngine(
      config.storage.outputDir,
      config.storage.prettyJson,
      config.capture.forceCapture
    );
    this.sessionId = generateSessionId(new Date());
  }

  async initialize(): Promise<void> {
    await this.storageEngine.initialize();

    // Initialize components registry manager if enabled
    if (this.config.capture.components?.enabled) {
      this.componentsRegistry = new ComponentsRegistryManager(
        this.config.storage.outputDir,
        'unknown',
        {
          minOccurrences: this.config.capture.components.minOccurrences,
          maxComponents: this.config.capture.components.maxComponents,
        }
      );
      await this.componentsRegistry.initialize();
    }

    logger.info(`Initialized runtime in ${this.mode} mode`);
  }

  async startRecorder(url: string, options: StartRecorderOptions = {}): Promise<void> {
    const scriptPath = await this.storageEngine.getUniqueScriptPath(url);
    
    logger.info(`Starting Playwright Codegen for: ${url}`);
    logger.info(`Script will be saved to: ${scriptPath}`);

    return new Promise((resolve, reject) => {
      let cliPath: string;
      try {
        cliPath = require.resolve('playwright-core/cli');
      } catch (e) {
        try {
          cliPath = require.resolve('playwright/cli');
        } catch (e2) {
          cliPath = path.join(process.cwd(), 'node_modules', 'playwright-core', 'cli.js');
        }
      }

      logger.debug(`Using Playwright CLI at: ${cliPath}`);
      logger.debug(`Using Playwright channel: msedge`);

      const env = { ...process.env };
      delete env.NODE_OPTIONS;

      const spawnArgs = [
        cliPath,
        'codegen',
        '-b', 'chromium',
        '--channel', 'msedge',
        '--output', scriptPath,
        url,
      ];

      logger.debug(`Spawning recorder: ${process.execPath} ${spawnArgs.join(' ')}`);

      const recorderProcess = spawn(
        process.execPath,
        spawnArgs,
        {
          stdio: 'inherit',
          shell: false,
          windowsHide: true,
          cwd: process.cwd(),
          env,
        }
      );

      recorderProcess.on('error', (err) => {
        logger.error(`Failed to start recorder: ${err.message}`);
        reject(err);
      });

      recorderProcess.on('close', (code) => {
        if (code === 0) {
          logger.info(`Script saved to: ${scriptPath}`);
        } else {
          // It's normal for codegen to return non-zero if closed via window X button sometimes
          logger.info(`Playwright Codegen session ended (code ${code})`);
        }

        this.storageEngine.mergeRecordedScript(url, scriptPath)
          .then(async (mergedPath) => {
            logger.info(`Merged script saved to: ${mergedPath}`);

            if (options.captureArtifacts) {
              try {
                await this.captureFromRecordedScript(mergedPath);
              } catch (err) {
                logger.warn(`Failed to capture artifacts from recorded script: ${(err as Error).message}`);
              }
            }
            resolve();
          })
          .catch((err: Error) => {
            logger.warn(`Failed to merge recorded script: ${err.message}`);
            resolve();
          });
      });
    });
  }

  private async captureFromRecordedScript(specPath: string): Promise<void> {
    const browser = await this.launchBrowser();
    const context = await this.createContext(browser);
    const page = await context.newPage();

    await this.setupPage(page);

    await this.executeRecordedSpecSteps(specPath, page);

    await this.shutdown();
  }

  private async executeRecordedSpecSteps(specPath: string, page: Page): Promise<void> {
    const source = fs.readFileSync(specPath, 'utf8');
    const body = this.extractTestBody(source);

    if (!body.trim()) {
      throw new Error(`No executable steps found in script: ${specPath}`);
    }

    const fn = new Function(
      'page',
      'expect',
      `"use strict"; return (async () => {\n${body}\n})();`
    ) as (page: Page, expect: typeof import('@playwright/test').expect) => Promise<void>;

    await fn(page, expect);
  }

  private extractTestBody(specSource: string): string {
    const lines = specSource.split(/\r?\n/);
    const bodyLines: string[] = [];

    let inTest = false;
    let startedBody = false;

    for (const line of lines) {
      if (!inTest) {
        if (/^\s*test\(/.test(line)) {
          inTest = true;
          if (line.includes('{')) {
            startedBody = true;
          }
        }
        continue;
      }

      if (!startedBody) {
        if (line.includes('{')) {
          startedBody = true;
        }
        continue;
      }

      if (/^\s*\}\);\s*$/.test(line)) {
        break;
      }

      bodyLines.push(line);
    }

    return bodyLines.join('\n').trim();
  }

  async launchBrowser(): Promise<Browser> {
    return await this.browserAdapter.launchBrowser(this.config);
  }

  async createContext(browser: Browser): Promise<any> {
    const context = await this.browserAdapter.createContext(browser, this.config);
    
    // Attach page handler for newly-created pages (popups)
    context.on('page', async (page: any) => {
      await this.setupPage(page);
    });

    // Attach setup to any existing pages
    const pages = context.pages();
    for (const p of pages) {
      await this.setupPage(p);
    }

    return context;
  }

  private async setupRecorderMode(page: Page): Promise<void> {
    logger.info('Setting up recorder mode');
    
    // Inject script to capture user interactions
    await page.addInitScript(() => {
      // Store recorded interactions
      (window as any).__contextGraph = {
        interactions: [],
        startTime: Date.now()
      };
      
      // Helper to record interactions
      const recordInteraction = (type: string, element: any, data?: any) => {
        const interaction = {
          type,
          timestamp: Date.now(),
          element: {
            tagName: element.tagName.toLowerCase(),
            id: element.id,
            className: element.className,
            text: element.textContent?.slice(0, 50) || '',
            xpath: getXPath(element),
            cssSelector: getCssSelector(element)
          },
          data: data || {}
        };
        
        (window as any).__contextGraph.interactions.push(interaction);
        console.log('ContextGraph: Recorded', type, interaction);
      };
      
      // Helper functions
      const getXPath = (element: any): string => {
        if (element.id) return `//*[@id="${element.id}"]`;
        if (element === document.body) return '/html/body';
        
        let ix = 0;
        const siblings = element.parentNode.childNodes;
        for (let i = 0; i < siblings.length; i++) {
          const sibling = siblings[i];
          if (sibling === element) {
            return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
          }
          if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
            ix++;
          }
        }
        return '';
      };
      
      const getCssSelector = (element: any): string => {
        if (element.id) return `#${element.id}`;
        if (element.className) {
          const classes = element.className.split(' ').filter((c: string) => c);
          return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
        }
        return element.tagName.toLowerCase();
      };
      
      // Record clicks
      document.addEventListener('click', (e) => {
        recordInteraction('click', e.target, {
          button: e.button,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey
        });
      }, true);
      
      // Record form inputs
      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        recordInteraction('input', target, {
          value: target.value.slice(0, 100), // Limit value length
          inputType: target.type,
          name: target.name
        });
      }, true);
      
      // Record focus changes
      document.addEventListener('focus', (e) => {
        recordInteraction('focus', e.target);
      }, true);
      
      // Record scroll events
      let scrollTimeout: any;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          recordInteraction('scroll', document.body, {
            scrollX: window.scrollX,
            scrollY: window.scrollY
          });
        }, 100);
      });
      
      // Record navigation
      const originalPushState = history.pushState;
      history.pushState = function(data: any, unused: string, url?: string | URL | null) {
        recordInteraction('navigation', document.body, {
          url: url?.toString(),
          method: 'pushState'
        });
        return originalPushState.apply(this, [data, unused, url]);
      };
      
      const originalReplaceState = history.replaceState;
      history.replaceState = function(data: any, unused: string, url?: string | URL | null) {
        recordInteraction('navigation', document.body, {
          url: url?.toString(),
          method: 'replaceState'
        });
        return originalReplaceState.apply(this, [data, unused, url]);
      };
      
      window.addEventListener('popstate', () => {
        recordInteraction('navigation', document.body, {
          url: location.href,
          method: 'popstate'
        });
      });
    });
    
    // Set up periodic capture of interactions
    const captureInteractions = async () => {
      try {
        const interactions = await page.evaluate(() => (window as any).__contextGraph?.interactions || []);
        if (interactions.length > 0) {
          logger.info(`Captured ${interactions.length} user interactions`);
          // Save interactions to a separate file
          await this.storageEngine.saveUserInteractions(page.url(), interactions);
        }
      } catch (error) {
        logger.debug(`Error capturing interactions: ${(error as Error).message}`);
      }
    };
    
    // Capture interactions every 5 seconds
    const interval = setInterval(captureInteractions, 5000);
    
    // Clean up on page close
    page.on('close', () => {
      clearInterval(interval);
      captureInteractions(); // Final capture
    });
  }

  async setupPage(page: Page): Promise<void> {
    try {
      // Ensure the page is ready before proceeding
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
        logger.debug('Network idle state not reached, continuing...');
      });

      // Attach listeners
      await this.browserAdapter.attachPageListeners(page);
      await this.captureEngine.attachNetworkListeners(page);
      
      // Set up recorder mode if enabled
      if (this.mode === RuntimeMode.RECORDER) {
        await this.setupRecorderMode(page);
      }
      
      // Prevent accidental closure using addInitScript instead of evaluateOnNewDocument
      await page.addInitScript(() => {
        window.addEventListener('beforeunload', (e) => {
          e.preventDefault();
          // @ts-ignore - TypeScript doesn't recognize returnValue on BeforeUnloadEvent
          e.returnValue = '';
          return '';
        });
      });
    } catch (error) {
      logger.error(`Error in setupPage: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    // Set up page change detection
    // Capture traditional load events
    page.on('load', async () => {
      const url = page.url();
      logger.info(`Page load detected: ${url}`);
      const key = this.normalizeUrl(url);
      if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
        logger.info(`New page detected (load event): ${url}`);
        this.capturedPages.add(key);
        await this.captureCurrentPage(page);
      } else {
        logger.debug(`Page already captured (load event): ${url}`);
      }
    });

    // Also capture DOMContentLoaded for faster detection
    page.on('domcontentloaded', async () => {
      const url = page.url();
      const key = this.normalizeUrl(url);
      if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
        logger.info(`New page detected (DOMContentLoaded): ${url}`);
        this.capturedPages.add(key);
        await this.captureCurrentPage(page);
      }
    });

    // Capture frame navigations (including main frame)
    page.on('framenavigated', async (frame) => {
      // Only capture main frame navigations to avoid duplicates
      if (frame === page.mainFrame()) {
        const url = frame.url();
        logger.info(`Frame navigated (main frame): ${url}`);
        const key = this.normalizeUrl(url);
        if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
          logger.info(`New page detected (framenavigated): ${url}`);
          this.capturedPages.add(key);
          await this.captureCurrentPage(page);
        } else {
          logger.debug(`Page already captured (framenavigated): ${url}`);
        }
      }
    });

    // Capture SPA navigation via history API
    try {
      await page.exposeBinding('cc_onHistoryChange', async (_source, url: string) => {
        logger.info(`History change detected: ${url}`);
        const key = this.normalizeUrl(url);
        if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
          logger.info(`New page detected (history API): ${url}`);
          this.capturedPages.add(key);
          // Add a small delay to ensure page is ready
          await new Promise(r => setTimeout(r, 300));
          await this.captureCurrentPage(page);
        } else {
          logger.debug(`Page already captured (history API): ${url}`);
        }
      });

      await page.addInitScript(() => {
        (function () {
          const origPush = history.pushState;
          history.pushState = function () {
            const ret = origPush.apply(this, arguments as any);
            try { 
              setTimeout(() => {
                (window as any)['cc_onHistoryChange'] && (window as any)['cc_onHistoryChange'](location.href);
              }, 100);
            } catch (e) {}
            return ret;
          };
          const origReplace = history.replaceState;
          history.replaceState = function () {
            const ret = origReplace.apply(this, arguments as any);
            try { 
              setTimeout(() => {
                (window as any)['cc_onHistoryChange'] && (window as any)['cc_onHistoryChange'](location.href);
              }, 100);
            } catch (e) {}
            return ret;
          };
          window.addEventListener('popstate', function () {
            try { 
              setTimeout(() => {
                (window as any)['cc_onHistoryChange'] && (window as any)['cc_onHistoryChange'](location.href);
              }, 100);
            } catch (e) {}
          });
        })();
      });
    } catch (error) {
      logger.warn(`Failed to set up history API interception: ${(error as Error).message}`);
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // Sort query params for consistent comparison
      const sortedParams = Array.from(u.searchParams.entries())
        .sort((a, b) => a[0].localeCompare(b[0]));
      const queryString = sortedParams.length > 0 
        ? '?' + sortedParams.map(([k, v]) => `${k}=${v}`).join('&')
        : '';
      // Fix: Include hash so SPAs (e.g., /#/dashboard) are treated as unique pages
      return `${u.origin}${u.pathname}${queryString}${u.hash}`;
    } catch {
      return url;
    }
  }

  private async captureCurrentPage(page: Page): Promise<void> {
    const captureWork = (async () => {
      const maxAttempts = 3;
      let attempt = 0;
      const startingUrl = page.url();
      
      while (attempt < maxAttempts) {
        attempt++;
        try {
          if (page.isClosed()) {
            logger.warn('Skipping capture: page is already closed');
            break;
          }

          // If the page has navigated since this capture was scheduled, abort to avoid racing navigation.
          const liveUrl = page.url();
          if (this.normalizeUrl(liveUrl) !== this.normalizeUrl(startingUrl)) {
            logger.info(`Skipping capture: page navigated during capture scheduling (${startingUrl} -> ${liveUrl})`);
            break;
          }

          // Wait for page to be stable
          try {
            await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {
              logger.debug('Network idle timeout, proceeding with capture');
            });
          } catch {
            await new Promise(r => setTimeout(r, 1000));
          }

          if (page.isClosed()) {
            logger.warn('Skipping capture: page closed while waiting for stability');
            break;
          }

          const currentUrl = page.url();
          logger.info(`Capturing page (attempt ${attempt}/${maxAttempts}): ${currentUrl}`);
          
          const consoleMessages = this.browserAdapter.getConsoleMessages();
          
          const snapshot = await this.captureEngine.capturePageSnapshot(page, this.config, consoleMessages);
          await this.storageEngine.savePageSnapshot(snapshot);

          // Update components registry
          if (this.componentsRegistry && this.config.capture.components?.enabled) {
            // Update registry domain if unknown
            if ((this.componentsRegistry as any).registry?.domain === 'unknown') {
              (this.componentsRegistry as any).registry.domain = snapshot.metadata.domain;
            }
            await this.componentsRegistry.processPage(snapshot);
          }
          
          this.browserAdapter.clearConsoleMessages();

          await this.storageEngine.updateGlobalManifest({
            captureId: snapshot.metadata.captureId,
            url: snapshot.metadata.url,
            title: snapshot.metadata.title,
            timestamp: snapshot.metadata.timestamp,
            sessionId: this.sessionId,
            domain: snapshot.metadata.domain,
            mode: this.mode,
          });

          logger.info(`✓ Successfully captured page: ${snapshot.metadata.url} (saved as: ${snapshot.metadata.pageName})`);
          break; 
        } catch (error) {
          const msg = (error as Error).message || '';
          logger.warn(`Capture attempt ${attempt} failed: ${msg}`);
          
          // Check for fatal browser closure errors - don't retry these
          if (/Target page, context or browser has been closed|Execution context was destroyed|Navigation cancelled/i.test(msg)) {
            logger.warn(`Capture aborted due to navigation/page close: ${msg}`);
            break; // don't retry these
          }
          
          // For other errors, retry if we haven't exhausted attempts
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }
          
          logger.error(`Failed to capture page: ${error}`);
          break;
        }
      }
    })();

    this.pendingCaptures.add(captureWork);
    try {
      await captureWork;
    } finally {
      this.pendingCaptures.delete(captureWork);
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shutdown timeout')), 20000)
      );
      await Promise.race([
        Promise.all(Array.from(this.pendingCaptures)),
        timeout
      ]);
      logger.info('All pending captures completed');
    } catch (err) {
      const error = err as Error;
      if (error.message === 'Shutdown timeout') {
        logger.warn('Shutdown timeout - some captures may still be in progress');
      } else {
        logger.warn('Error waiting for pending captures: ' + error.message);
      }
    }

    // Persist components registry and update manifest reference
    try {
      if (this.componentsRegistry && this.config.capture.components?.enabled) {
        const domain = this.componentsRegistry.getRegistry().domain;
        const domainName = (() => {
          const parts = domain.split('.');
          const filtered = parts.filter(p => p.toLowerCase() !== 'www');
          if (filtered.length >= 2) return filtered[filtered.length - 2];
          return filtered[0] || parts[0];
        })();

        const registry = this.componentsRegistry.getRegistry();
        await this.storageEngine.saveComponentsRegistry(registry, domainName);
        await this.storageEngine.updateManifestWithComponents(domainName, registry.components.length);
      }
    } catch (error) {
      logger.warn(`Failed to persist components registry: ${(error as Error).message}`);
    }

    await this.browserAdapter.close();
    logger.info('Runtime shutdown complete');
  }

  onBrowserDisconnect(callback: () => void): void {
    this.browserAdapter.onBrowserDisconnect(callback);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async capturePageIfNeeded(page: Page): Promise<void> {
    try {
      const url = page.url();
      const key = this.normalizeUrl(url);
      
      if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
        logger.info(`New page detected: ${url}`);
        
        // Ensure page is stable before capturing
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
          logger.debug('Network idle state not reached, continuing with capture...');
        });
        
        await this.captureCurrentPage(page);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in capturePageIfNeeded: ${errorMessage}`);
      throw error;
    }
  }
}