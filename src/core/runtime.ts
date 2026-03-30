// Developer: Shadow Coderr, Architect
import { Browser, Page, expect } from '@playwright/test';
import * as vm from 'vm';
import { Config } from '../types/config';
import { BrowserAdapter } from './browser-adapter';
import { CaptureEngine } from './capture-engine';
import { StorageEngine } from '../storage/engine';
import { ComponentsRegistryManager } from '../registry/components-registry';
import { PageNotifier } from '../analyzers/page-notifier';
import { AIContextBundler } from '../exporters/ai-context-bundler';
import { NetworkPatternAnalyzer } from '../analyzers/network-patterns';
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
  private pageNotifier: PageNotifier;

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
      config.capture.forceCapture,
    );
    this.pageNotifier = new PageNotifier(
      config.capture.notifications?.enabled ?? true,
    );
    this.sessionId = generateSessionId(new Date());
  }

  async initialize(): Promise<void> {
    await this.storageEngine.initialize();

    if (this.config.capture.components?.enabled) {
      this.componentsRegistry = new ComponentsRegistryManager(
        this.config.storage.outputDir,
        'unknown',
        {
          minOccurrences: this.config.capture.components.minOccurrences,
          maxComponents: this.config.capture.components.maxComponents,
        },
      );
      await this.componentsRegistry.initialize();
    }

    logger.info(`RuntimeController: initialized in ${this.mode} mode`);
  }

  async startRecorder(url: string, options: StartRecorderOptions = {}): Promise<void> {
    // Security: validate URL scheme
    const allowedSchemes = ['http:', 'https:'];
    try {
      const parsedUrl = new URL(url);
      if (!allowedSchemes.includes(parsedUrl.protocol)) {
        throw new Error(
          `Recorder URL must use http or https scheme. Received: ${parsedUrl.protocol}`,
        );
      }
    } catch (e) {
      if (e instanceof TypeError) throw new Error(`Invalid recorder URL: ${url}`);
      throw e;
    }

    const scriptPath = await this.storageEngine.getUniqueScriptPath(url);

    logger.info(`RuntimeController: starting Playwright Codegen for: ${url}`);
    logger.info(`RuntimeController: script will be saved to: ${scriptPath}`);

    return new Promise((resolve, reject) => {
      let cliPath: string;
      try {
        cliPath = require.resolve('playwright-core/cli');
      } catch {
        try {
          cliPath = require.resolve('playwright/cli');
        } catch {
          cliPath = path.join(
            process.cwd(),
            'node_modules',
            'playwright-core',
            'cli.js',
          );
        }
      }

      const env = { ...process.env };
      delete env.NODE_OPTIONS;

      const spawnArgs = [
        cliPath,
        'codegen',
        '-b',
        'chromium',
        '--channel',
        'msedge',
        '--output',
        scriptPath,
        url,
      ];

      const recorderProcess = spawn(process.execPath, spawnArgs, {
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
        cwd: process.cwd(),
        env,
      });

      recorderProcess.on('error', (err) => {
        logger.error(`RuntimeController: failed to start recorder — ${err.message}`);
        reject(err);
      });

      recorderProcess.on('close', (code) => {
        logger.info(`RuntimeController: codegen session ended (code ${code})`);

        this.storageEngine
          .mergeRecordedScript(url, scriptPath)
          .then(async (mergedPath) => {
            logger.info(`RuntimeController: merged script saved to: ${mergedPath}`);
            if (options.captureArtifacts) {
              try {
                await this.captureFromRecordedScript(mergedPath);
              } catch (err) {
                logger.warn(
                  `RuntimeController: artifact capture from script failed — ${(err as Error).message}`,
                );
              }
            }
            resolve();
          })
          .catch((err: Error) => {
            logger.warn(`RuntimeController: script merge failed — ${err.message}`);
            resolve();
          });
      });
    });
  }

  private async captureFromRecordedScript(specPath: string): Promise<void> {
    const resolvedSpec = path.resolve(specPath);
    const resolvedScriptsDir = path.resolve(this.storageEngine.getScriptsDir());
    const scriptsPrefix = resolvedScriptsDir + path.sep;
    if (!resolvedSpec.startsWith(scriptsPrefix)) {
      throw new Error(
        `Spec file path is outside the controlled scripts directory: ${resolvedSpec}`,
      );
    }

    const ext = path.extname(resolvedSpec).toLowerCase();
    const base = path.basename(resolvedSpec, ext).toLowerCase();
    if (!base.endsWith('.spec') || (ext !== '.ts' && ext !== '.js')) {
      throw new Error(
        `Spec file must have a .spec.ts or .spec.js extension. Received: ${path.basename(resolvedSpec)}`,
      );
    }

    if (!fs.existsSync(resolvedSpec)) {
      throw new Error(`Spec file not found: ${resolvedSpec}`);
    }

    const browser = await this.launchBrowser();
    const context = await this.createContext(browser);
    const page = await context.newPage();
    await this.setupPage(page);
    await this.executeRecordedSpecSteps(resolvedSpec, page);
    await this.shutdown();
  }

  private async executeRecordedSpecSteps(specPath: string, page: Page): Promise<void> {
    const source = fs.readFileSync(specPath, 'utf8');
    const body = this.extractTestBody(source);

    if (!body.trim()) {
      throw new Error(`No executable steps found in script: ${specPath}`);
    }

    const sandboxContext = vm.createContext({
      page,
      expect,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      Buffer,
    });

    const wrappedBody = `(async () => {\n"use strict";\n${body}\n})()`;
    const script = new vm.Script(wrappedBody, {
      filename: path.basename(specPath),
    });

    const specTimeoutMs = 120_000;
    const executionPromise = script.runInContext(sandboxContext) as Promise<void>;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Spec execution timed out after ${specTimeoutMs / 1000}s`),
          ),
        specTimeoutMs,
      ),
    );

    await Promise.race([executionPromise, timeoutPromise]);
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
          if (line.includes('{')) startedBody = true;
        }
        continue;
      }
      if (!startedBody) {
        if (line.includes('{')) startedBody = true;
        continue;
      }
      if (/^\s*\}\);\s*$/.test(line)) break;
      bodyLines.push(line);
    }

    return bodyLines.join('\n').trim();
  }

  async launchBrowser(): Promise<Browser> {
    return await this.browserAdapter.launchBrowser(this.config);
  }

  async createContext(browser: Browser): Promise<any> {
    const context = await this.browserAdapter.createContext(browser, this.config);

    context.on('page', async (page: any) => {
      await this.setupPage(page);
    });

    const pages = context.pages();
    for (const p of pages) {
      await this.setupPage(p);
    }

    return context;
  }

  private async setupRecorderMode(page: Page): Promise<void> {
    logger.info('RuntimeController: setting up recorder mode');

    await page.addInitScript(() => {
      (window as any).__contextGraph = {
        interactions: [],
        startTime: Date.now(),
      };

      const recordInteraction = (type: string, element: any, data?: any) => {
        const getXPath = (el: any): string => {
          if (el.id) return `//*[@id="${el.id}"]`;
          if (el === document.body) return '/html/body';
          let ix = 0;
          const siblings = el.parentNode?.childNodes || [];
          for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === el)
              return `${getXPath(el.parentNode)}/${el.tagName.toLowerCase()}[${ix + 1}]`;
            if (sibling.nodeType === 1 && sibling.tagName === el.tagName) ix++;
          }
          return '';
        };

        const getCss = (el: any): string => {
          if (el.id) return `#${el.id}`;
          if (el.className) {
            const cls = el.className.split(' ').filter((c: string) => c);
            return `${el.tagName.toLowerCase()}.${cls.join('.')}`;
          }
          return el.tagName.toLowerCase();
        };

        (window as any).__contextGraph.interactions.push({
          type,
          timestamp: Date.now(),
          element: {
            tagName: element.tagName?.toLowerCase(),
            id: element.id,
            className: element.className,
            text: element.textContent?.slice(0, 50) || '',
            xpath: getXPath(element),
            cssSelector: getCss(element),
          },
          data: data || {},
        });
      };

      document.addEventListener('click', (e) =>
        recordInteraction('click', e.target, { button: e.button }), true,
      );
      document.addEventListener('input', (e) => {
        const t = e.target as HTMLInputElement;
        recordInteraction('input', t, {
          value: t.value.slice(0, 100),
          inputType: t.type,
          name: t.name,
        });
      }, true);

      const origPush = history.pushState;
      history.pushState = function (d, u, url) {
        recordInteraction('navigation', document.body, { url: url?.toString(), method: 'pushState' });
        return origPush.apply(this, [d, u, url]);
      };
    });

    const captureInteractions = async () => {
      try {
        const interactions = await page.evaluate(
          () => (window as any).__contextGraph?.interactions || [],
        );
        if (interactions.length > 0) {
          await this.storageEngine.saveUserInteractions(page.url(), interactions);
        }
      } catch { /* page may be closed */ }
    };

    const interval = setInterval(captureInteractions, 5000);
    page.on('close', () => {
      clearInterval(interval);
      captureInteractions();
    });
  }

  async setupPage(page: Page): Promise<void> {
    try {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
        logger.debug('RuntimeController: network idle state not reached, continuing');
      });

      await this.browserAdapter.attachPageListeners(page);
      await this.captureEngine.attachNetworkListeners(page);

      if (this.mode === RuntimeMode.RECORDER) {
        await this.setupRecorderMode(page);
      }

      try {
        await this.pageNotifier.injectStyles(page);
      } catch (error) {
        logger.debug(
          `RuntimeController: PageNotifier styles injection failed (non-fatal): ${(error as Error).message}`,
        );
      }

      await page.addInitScript(() => {
        window.addEventListener('beforeunload', (e) => {
          e.preventDefault();
          // @ts-ignore
          e.returnValue = '';
          return '';
        });
      });
    } catch (error) {
      logger.error(
        `RuntimeController: setupPage failed — ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    // ── Navigation capture listeners ────────────────────────────────────────

    page.on('load', async () => {
      const url = page.url();
      const key = this.normalizeUrl(url);
      if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
        logger.info(`RuntimeController: new page (load): ${url}`);
        this.capturedPages.add(key);
        await this.captureCurrentPage(page);
      }
    });

    page.on('domcontentloaded', async () => {
      const url = page.url();
      const key = this.normalizeUrl(url);
      if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
        logger.info(`RuntimeController: new page (DOMContentLoaded): ${url}`);
        this.capturedPages.add(key);
        await this.captureCurrentPage(page);
      }
    });

    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        const key = this.normalizeUrl(url);
        if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
          logger.info(`RuntimeController: new page (framenavigated): ${url}`);
          this.capturedPages.add(key);
          await this.captureCurrentPage(page);
        }
      }
    });

    try {
      await page.exposeBinding('cc_onHistoryChange', async (_source, url: string) => {
        const key = this.normalizeUrl(url);
        if (!this.capturedPages.has(key) && this.isValidUrl(url)) {
          logger.info(`RuntimeController: new page (history API): ${url}`);
          this.capturedPages.add(key);
          await new Promise((r) => setTimeout(r, 300));
          await this.captureCurrentPage(page);
        }
      });

      await page.addInitScript(() => {
        (function () {
          const origPush = history.pushState;
          history.pushState = function () {
            const ret = origPush.apply(this, arguments as any);
            try {
              setTimeout(() => {
                (window as any)['cc_onHistoryChange'] &&
                  (window as any)['cc_onHistoryChange'](location.href);
              }, 100);
            } catch {}
            return ret;
          };
          const origReplace = history.replaceState;
          history.replaceState = function () {
            const ret = origReplace.apply(this, arguments as any);
            try {
              setTimeout(() => {
                (window as any)['cc_onHistoryChange'] &&
                  (window as any)['cc_onHistoryChange'](location.href);
              }, 100);
            } catch {}
            return ret;
          };
          window.addEventListener('popstate', function () {
            try {
              setTimeout(() => {
                (window as any)['cc_onHistoryChange'] &&
                  (window as any)['cc_onHistoryChange'](location.href);
              }, 100);
            } catch {}
          });
        })();
      });
    } catch (error) {
      logger.warn(
        `RuntimeController: history API interception failed — ${(error as Error).message}`,
      );
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      const sortedParams = Array.from(u.searchParams.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      const queryString =
        sortedParams.length > 0
          ? '?' + sortedParams.map(([k, v]) => `${k}=${v}`).join('&')
          : '';
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

      await this.pageNotifier.show(page, 'processing').catch(() => {});
      let captureSucceeded = false;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          if (page.isClosed()) {
            logger.warn('RuntimeController: skipping capture — page is closed');
            break;
          }

          const liveUrl = page.url();
          if (this.normalizeUrl(liveUrl) !== this.normalizeUrl(startingUrl)) {
            logger.info(
              `RuntimeController: skipping capture — page navigated during scheduling`,
            );
            break;
          }

          try {
            await page
              .waitForLoadState('networkidle', { timeout: 3000 })
              .catch(() => logger.debug('RuntimeController: network idle timeout, proceeding'));
          } catch {
            await new Promise((r) => setTimeout(r, 1000));
          }

          if (page.isClosed()) {
            logger.warn('RuntimeController: skipping capture — page closed during wait');
            break;
          }

          const currentUrl = page.url();
          logger.info(
            `RuntimeController: capturing page (attempt ${attempt}/${maxAttempts}): ${currentUrl}`,
          );

          const consoleMessages = this.browserAdapter.getConsoleMessages();

          const snapshot = await this.captureEngine.capturePageSnapshot(
            page,
            this.config,
            consoleMessages,
            this.storageEngine['outputDir'],
          );
          await this.storageEngine.savePageSnapshot(snapshot);

          if (this.componentsRegistry && this.config.capture.components?.enabled) {
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

          logger.info(
            `RuntimeController: ✓ captured page: ${snapshot.metadata.url} (saved as: ${snapshot.metadata.pageName})`,
          );
          captureSucceeded = true;
          break;
        } catch (error) {
          const msg = (error as Error).message || '';
          logger.warn(`RuntimeController: capture attempt ${attempt} failed — ${msg}`);

          if (
            /Target page, context or browser has been closed|Execution context was destroyed|Navigation cancelled/i.test(
              msg,
            )
          ) {
            logger.warn('RuntimeController: capture aborted — navigation/page close');
            break;
          }

          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }

          logger.error(`RuntimeController: capture failed permanently — ${error}`);
          break;
        }
      }

      if (captureSucceeded) {
        await this.pageNotifier.show(page, 'success', { autoDismissMs: 4000 }).catch(() => {});
      } else {
        await this.pageNotifier.show(page, 'error').catch(() => {});
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
    // ── Wait for all in-flight captures ────────────────────────────────────
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Shutdown timeout')), 20000),
      );
      await Promise.race([
        Promise.all(Array.from(this.pendingCaptures)),
        timeout,
      ]);
      logger.info('RuntimeController: all pending captures completed');
    } catch (err) {
      const error = err as Error;
      if (error.message === 'Shutdown timeout') {
        logger.warn('RuntimeController: shutdown timeout — some captures may still be running');
      } else {
        logger.warn(`RuntimeController: error waiting for captures — ${error.message}`);
      }
    }

    // ── Persist components registry ─────────────────────────────────────────
    try {
      if (this.componentsRegistry && this.config.capture.components?.enabled) {
        const domain = this.componentsRegistry.getRegistry().domain;
        const domainName = (() => {
          const parts = domain.split('.');
          const filtered = parts.filter((p) => p.toLowerCase() !== 'www');
          if (filtered.length >= 2) return filtered[filtered.length - 2];
          return filtered[0] || parts[0];
        })();

        const registry = this.componentsRegistry.getRegistry();
        await this.storageEngine.saveComponentsRegistry(registry, domainName);
        await this.storageEngine.updateManifestWithComponents(
          domainName,
          registry.components.length,
        );
      }
    } catch (error) {
      logger.warn(
        `RuntimeController: components registry persist failed — ${(error as Error).message}`,
      );
    }

    // ── Auto-generate post-capture artifacts ────────────────────────────────
    await this.generatePostCaptureArtifacts();

    // ── Close browser ───────────────────────────────────────────────────────
    await this.browserAdapter.close();
    logger.info('RuntimeController: shutdown complete');
  }

  /**
   * Automatically generate API inventory and AI context bundle after every
   * session.  Both are non-blocking best-effort operations — a failure in
   * either does NOT abort shutdown or raise to the caller.
   */
  private async generatePostCaptureArtifacts(): Promise<void> {
    const outputDir = this.config.storage.outputDir;

    // 1. API Inventory (NetworkPatternAnalyzer reads traffic_log.jsonl and
    //    writes api_inventory.json to the domain directory)
    try {
      const analyzer = new NetworkPatternAnalyzer(outputDir);
      const inventoryPath = await analyzer.analyze();
      logger.info(`RuntimeController: API inventory → ${inventoryPath}`);
    } catch (error) {
      logger.warn(
        `RuntimeController: API inventory generation failed (non-fatal) — ${(error as Error).message}`,
      );
    }

    // 2. AI Context Bundle (AIContextBundler reads all page directories and
    //    writes bundles/ai_context_bundle.md)
    try {
      const bundler = new AIContextBundler(outputDir);
      const bundlePath = await bundler.bundle();
      logger.info(`RuntimeController: AI bundle → ${bundlePath}`);
    } catch (error) {
      logger.warn(
        `RuntimeController: AI bundle generation failed (non-fatal) — ${(error as Error).message}`,
      );
    }
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
        logger.info(`RuntimeController: capturePageIfNeeded: ${url}`);
        await page.waitForLoadState('domcontentloaded');
        await page
          .waitForLoadState('networkidle', { timeout: 10000 })
          .catch(() =>
            logger.debug('RuntimeController: network idle not reached, capturing anyway'),
          );
        await this.captureCurrentPage(page);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`RuntimeController: capturePageIfNeeded failed — ${msg}`);
      throw error;
    }
  }
}
