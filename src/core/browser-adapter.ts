// Developer: Shadow Coderr, Architect
import { Browser, BrowserContext, Page } from '@playwright/test';
import { Config } from '../types/config';
import { FrameHierarchy } from '../types/capture';
import { logger } from '../utils/logger';

export class BrowserAdapter {
  private browser?: Browser;
  private context?: BrowserContext;
  private isClosed = false;

  async launchBrowser(config: Config): Promise<Browser> {
    const { chromium, firefox } = await import('playwright');

    let browserType: any;
    switch (config.browser.channel) {
      case 'msedge':
      case 'chromium':
        browserType = chromium;
        break;
      case 'firefox':
        browserType = firefox;
        break;
      default:
        throw new Error(`Unsupported browser: ${config.browser.channel}`);
    }

    const launchOptions: any = {
      headless: config.browser.headless,
      slowMo: config.browser.slowMo,
      devtools: config.browser.devtools,
      args: [
        '--start-maximized',
        '--disable-extensions',
        '--disable-popup-blocking',
        '--disable-notifications',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--password-store=basic'
      ],
      handleSIGINT: false, // Don't close browser on Ctrl+C
      handleSIGTERM: false,
      handleSIGHUP: false,
    };

    // When requesting msedge, instruct playwright to use the msedge channel
    if (config.browser.channel === 'msedge' && browserType === chromium) {
      launchOptions.channel = 'msedge';
    }

    this.browser = await browserType.launch(launchOptions);

    if (!this.browser) {
      throw new Error('Failed to launch browser');
    }

    logger.info(`Launched ${config.browser.channel} browser`);
    return this.browser;
  }

  async createContext(browser: Browser, config?: any): Promise<BrowserContext> {
    // Check if --start-maximized is being used
    const isMaximized = true; // Since we're always using --start-maximized in launchOptions
    
    const contextOptions: any = {
      // Disable fixed viewport to allow window sizing when maximized
      viewport: isMaximized ? null : (config?.viewport || null),
      isMobile: false,
      hasTouch: false,
      javaScriptEnabled: true,
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Keep the browser process alive
      closeBrowserOnContextClose: false,
    };
    
    // Only set viewport if explicitly provided in config AND not using --start-maximized
    if (config?.viewport && !isMaximized) {
      contextOptions.viewport = {
        width: config.viewport.width,
        height: config.viewport.height,
      };
    }

    this.context = await browser.newContext(contextOptions);

    logger.info('Created browser context');
    return this.context;
  }

  private consoleMessages: Array<{ type: string; message: string; location: any; timestamp: string; stack?: string | undefined }> = [];

  getConsoleMessages(): Array<{ type: string; message: string; location: any; timestamp: string; stack?: string | undefined }> {
    return [...this.consoleMessages];
  }

  clearConsoleMessages(): void {
    this.consoleMessages = [];
  }

  async attachPageListeners(page: Page): Promise<void> {
    page.on('load', () => {
      logger.debug('Page loaded');
    });

    page.on('domcontentloaded', () => {
      logger.debug('DOM content loaded');
    });

    page.on('console', (msg) => {
      const message = {
        type: msg.type(),
        message: msg.text(),
        location: msg.location(),
        timestamp: new Date().toISOString(),
        stack: msg.type() === 'error' ? msg.text() : undefined,
      };
      this.consoleMessages.push(message);
      logger.debug(`Console: ${msg.type()}: ${msg.text()}`);
    });

    page.on('pageerror', (error) => {
      const errorMsg: any = {
        type: 'error',
        message: error.message,
        location: { url: page.url(), lineNumber: 0, columnNumber: 0 },
        timestamp: new Date().toISOString(),
      };
      if (error.stack) {
        errorMsg.stack = error.stack;
      }
      this.consoleMessages.push(errorMsg);
      logger.warn(`Page error: ${error.message}`);
    });
  }

  onBrowserDisconnect(callback: () => void): void {
    // Register a guarded disconnect handler
    if (this.browser) {
      this.browser.on('disconnected', () => {
        try {
          callback();
        } catch (error) {
          logger.warn(`Error in browser disconnect handler: ${(error as Error).message}`);
        }
      });
    }
  }

  async getFrameHierarchy(page: Page): Promise<FrameHierarchy> {
    const frames = page.frames();

    const buildHierarchy = (frame: any): FrameHierarchy => {
      return {
        url: frame.url(),
        name: frame.name(),
        children: frame.childFrames().map(buildHierarchy),
      };
    };

    return buildHierarchy(frames[0]); // Main frame
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      if (this.context) {
        await this.context.close();
      }
    } catch (error) {
      logger.warn('Error closing browser context: ' + (error as Error).message);
    }

    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch (error) {
      logger.warn('Error closing browser: ' + (error as Error).message);
    }

    logger.info('Browser closed');
  }
}
