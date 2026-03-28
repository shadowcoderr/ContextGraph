// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface ScreenshotOptions {
  fullPage: boolean;
  format: 'png' | 'jpeg' | 'webp';
  quality?: number; // 0–100 for jpeg/webp
  elementTargeting: boolean;
  maxElements: number;
  timeout: number;
}

export interface ScreenshotResult {
  fullPagePath?: string | undefined;
  elementPaths: Array<{
    elementId: string;
    path: string;
    selector: string;
    label?: string | undefined;
  }>;
  capturedAt: string;
  dimensions?: {
    width: number;
    height: number;
  } | undefined;
}

const DEFAULT_OPTIONS: ScreenshotOptions = {
  fullPage: true,
  format: 'png',
  quality: 90,
  elementTargeting: false,
  maxElements: 10,
  timeout: 15000,
};

export class ScreenshotCapturer {
  private options: ScreenshotOptions;

  constructor(options?: Partial<ScreenshotOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Capture a full-page screenshot and return the saved path, or null on failure.
   */
  async captureFullPage(page: Page, outputDir: string, _captureId: string): Promise<string | null> {
    try {
      await fs.ensureDir(outputDir);

      const filename = `screenshot.${this.options.format}`;
      const filepath = path.join(outputDir, filename);

      const screenshotOpts: any = {
        path: filepath,
        fullPage: this.options.fullPage,
        type: this.options.format === 'webp' ? 'png' : this.options.format, // Playwright screenshot doesn't support webp directly in some versions, fallback to png for type if it's webp or just cast to any
        animations: 'disabled',
        timeout: this.options.timeout,
      };

      // quality only applies to lossy formats
      if (this.options.format !== 'png' && this.options.quality !== undefined) {
        (screenshotOpts as any).quality = this.options.quality;
      }

      await page.screenshot(screenshotOpts);
      logger.info(`Full-page screenshot saved: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.warn(`Failed to capture full-page screenshot: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Capture individual element screenshots for key interactive elements.
   * Elements that are not visible, off-screen, or zero-size are skipped gracefully.
   */
  async captureElementScreenshots(
    page: Page,
    outputDir: string,
    _captureId: string,
    elements: Array<{ elementId: string; selector: string; label?: string }>
  ): Promise<ScreenshotResult['elementPaths']> {
    const results: ScreenshotResult['elementPaths'] = [];

    await fs.ensureDir(outputDir);

    const batch = elements.slice(0, this.options.maxElements);

    for (const element of batch) {
      try {
        const locator = page.locator(element.selector).first();

        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;

        const isVisible = await locator.isVisible({ timeout: 2000 }).catch(() => false);
        if (!isVisible) continue;

        const box = await locator.boundingBox().catch(() => null);
        if (!box || box.width === 0 || box.height === 0) continue;

        const safe = element.elementId.replace(/[^a-z0-9_-]/gi, '_');
        const filename = `element_${safe}.${this.options.format}`;
        const filepath = path.join(outputDir, filename);

        const eleOpts: any = {
          path: filepath,
          type: this.options.format === 'webp' ? 'png' : this.options.format,
          animations: 'disabled',
          timeout: this.options.timeout,
        };

        if (this.options.format !== 'png' && this.options.quality !== undefined) {
          (eleOpts as any).quality = this.options.quality;
        }

        await locator.screenshot(eleOpts);
        results.push({ 
          elementId: element.elementId, 
          path: filepath, 
          selector: element.selector, 
          label: element.label || undefined 
        });
        logger.debug(`Element screenshot saved: ${filepath}`);
      } catch (error) {
        logger.debug(`Skipping element screenshot (${element.elementId}): ${(error as Error).message}`);
      }
    }

    return results;
  }

  /**
   * Orchestrates capturing screenshots for a page. Returns a ScreenshotResult
   * with all paths.  The caller is responsible for creating `pageDir`.
   */
  async capturePageScreenshots(
    page: Page,
    pageDir: string,
    captureId: string,
    interactiveElements: Array<{ elementId: string; selector: string; label?: string }> = []
  ): Promise<ScreenshotResult> {
    const screenshotsDir = path.join(pageDir, 'screenshots');
    const result: ScreenshotResult = {
      elementPaths: [],
      capturedAt: new Date().toISOString(),
    };

    // Full-page screenshot
    const fullPagePath = await this.captureFullPage(page, screenshotsDir, captureId);
    if (fullPagePath) {
      result.fullPagePath = fullPagePath;

      // Attempt to read dimensions via viewport
      try {
        const vp = page.viewportSize();
        if (vp) {
          result.dimensions = { width: vp.width, height: vp.height };
        }
      } catch (error) {
        logger.debug(`Failed to get viewport size: ${(error as Error).message}`);
      }
    }

    // Optional element-level screenshots
    if (this.options.elementTargeting && interactiveElements.length > 0) {
      const elementsDir = path.join(screenshotsDir, 'elements');
      result.elementPaths = await this.captureElementScreenshots(
        page,
        elementsDir,
        captureId,
        interactiveElements
      );
    }

    return result;
  }

  /**
   * Build a list of element descriptors suitable for element screenshot capture
   * from locators data.
   */
  static buildElementTargets(
    locatorsElements: Array<{
      elementId: string;
      tagName: string;
      text?: string;
      attributes: Record<string, any>;
      computedState: { isVisible: boolean; isEnabled: boolean };
      locators: Array<{ strategy: string; value: string; isUnique?: boolean }>;
    }>
  ): Array<{ elementId: string; selector: string; label?: string }> {
    return locatorsElements
      .filter(el => el.computedState.isVisible && el.computedState.isEnabled)
      .filter(el => ['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName))
      .map(el => {
        // Prefer a unique locator or fall back to the first available
        const best =
          el.locators.find(l => l.isUnique && l.strategy === 'testid') ||
          el.locators.find(l => l.isUnique && l.strategy === 'role') ||
          el.locators.find(l => l.isUnique) ||
          el.locators[0];

        if (!best) return null;

        return {
          elementId: el.elementId,
          selector: el.attributes?.['data-testid']
            ? `[data-testid="${el.attributes['data-testid']}"]`
            : el.attributes?.id
            ? `#${el.attributes.id}`
            : best.value,
          label: el.text?.trim().substring(0, 40) || el.attributes?.['aria-label'] || undefined,
        };
      })
      .filter(Boolean) as Array<{ elementId: string; selector: string; label?: string }>;
  }
}
