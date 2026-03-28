// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { getVersion } from '../utils/version';

export interface BundleOptions {
  /** Output format: 'markdown' (default) or 'json' */
  format: 'markdown' | 'json';
  /** Maximum elements per page to include in the bundle */
  maxElementsPerPage: number;
  /** Maximum a11y tree depth to include */
  maxA11yDepth: number;
  /** Include network event summary */
  includeNetwork: boolean;
  /** Include console errors */
  includeConsoleErrors: boolean;
  /** Output file name (without extension) */
  outputFileName: string;
}

const DEFAULT_OPTIONS: BundleOptions = {
  format: 'markdown',
  maxElementsPerPage: 30,
  maxA11yDepth: 5,
  includeNetwork: true,
  includeConsoleErrors: true,
  outputFileName: 'ai_context_bundle',
};

export interface BundledPage {
  url: string;
  title: string;
  pageName: string;
  capturedAt: string;
  elements: Array<{
    role: string;
    name?: string | undefined;
    bestLocator: string;
    state: string;
    position?: string | undefined;
  }>;
  a11ySummary: string;
  apiCalls: Array<{ method: string; path: string; status?: number | undefined; durationMs?: number | undefined }>;
  consoleErrors: Array<{ message: string; source?: string | undefined }>;
  formFields: Array<{ label?: string | undefined; type: string; required: boolean; locator: string }>;
}

/**
 * AIContextBundler
 *
 * Packages one or all captured pages into a single Markdown (or JSON) file
 * that can be pasted directly into an AI IDE agent (Copilot, Cursor, Claude)
 * for immediate test generation or analysis.
 *
 * Usage (after a ContextGraph capture session):
 *
 *   const bundler = new AIContextBundler(outputDir);
 *   await bundler.bundle();
 *   // → context-graph-output/bundles/ai_context_bundle.md
 *
 * The resulting file contains:
 *   - Session summary (domain, page count, captured timestamp)
 *   - Per-page: interactive element table, condensed a11y tree,
 *     API calls observed, console errors, and form field details
 *   - Ready-to-use prompt template at the end
 */
export class AIContextBundler {
  private outputDir: string;
  private options: BundleOptions;

  constructor(outputDir: string, options?: Partial<BundleOptions>) {
    this.outputDir = path.resolve(outputDir);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Bundle all captured pages in the output directory into a single file.
   * Returns the path to the generated bundle.
   */
  async bundle(): Promise<string> {
    logger.info('AIContextBundler: starting bundle generation');

    const manifest = await this.loadManifest();
    const domain = this.detectDomain();

    if (!domain) {
      throw new Error('No captured domain found in output directory');
    }

    const pagesDir = path.join(this.outputDir, domain, 'pages');
    if (!(await fs.pathExists(pagesDir))) {
      throw new Error(`Pages directory not found: ${pagesDir}`);
    }

    const pageDirs = (await fs.readdir(pagesDir, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();

    const bundledPages: BundledPage[] = [];

    for (const pageName of pageDirs) {
      try {
        const bundledPage = await this.bundlePage(path.join(pagesDir, pageName), pageName);
        if (bundledPage) bundledPages.push(bundledPage);
      } catch (error) {
        logger.warn(`AIContextBundler: skipping page ${pageName}: ${(error as Error).message}`);
      }
    }

    if (bundledPages.length === 0) {
      throw new Error('No pages could be bundled — ensure at least one capture has been performed');
    }

    const outputPath = await this.write(bundledPages, domain, manifest);
    logger.info(`AIContextBundler: bundle saved to ${outputPath}`);
    return outputPath;
  }

  /**
   * Bundle a single specific page by page name.
   */
  async bundleSinglePage(pageName: string): Promise<string> {
    const domain = this.detectDomain();
    if (!domain) throw new Error('No captured domain found');

    const pageDir = path.join(this.outputDir, domain, 'pages', pageName);
    if (!(await fs.pathExists(pageDir))) {
      throw new Error(`Page directory not found: ${pageDir}`);
    }

    const bundledPage = await this.bundlePage(pageDir, pageName);
    if (!bundledPage) throw new Error(`Could not bundle page: ${pageName}`);

    return this.write([bundledPage], domain, null);
  }

  // ── Private: loading and parsing ──────────────────────────────────────────────

  private async loadManifest(): Promise<any | null> {
    const manifestPath = path.join(this.outputDir, 'global_manifest.json');
    if (!(await fs.pathExists(manifestPath))) return null;
    return fs.readJson(manifestPath).catch(() => null);
  }

  private detectDomain(): string | null {
    try {
      const entries = fs.readdirSync(this.outputDir, { withFileTypes: true });
      const domainDir = entries.find(
        e => e.isDirectory() && !['scripts', 'bundles', 'logs'].includes(e.name)
      );
      return domainDir?.name || null;
    } catch {
      return null;
    }
  }

  private async bundlePage(pageDir: string, pageName: string): Promise<BundledPage | null> {
    const metadataPath = path.join(pageDir, 'metadata.json');
    const locatorsPath = path.join(pageDir, 'locators.json');
    const a11yPath = path.join(pageDir, 'a11y_tree.json');
    const consolePath = path.join(pageDir, 'console_errors.json');

    if (!(await fs.pathExists(metadataPath))) return null;

    const metadata = await fs.readJson(metadataPath);
    const locators = await fs.readJson(locatorsPath).catch(() => ({ elements: [] }));
    const a11y = await fs.readJson(a11yPath).catch(() => null);
    const consoleData = await fs.readJson(consolePath).catch(() => null);

    // ── Interactive elements ──
    const elements = this.extractElements(locators.elements || [], this.options.maxElementsPerPage);

    // ── Form fields ──
    const formFields = this.extractFormFields(locators.formFields || [], locators.elements || []);

    // ── A11y summary ──
    const a11ySummary = a11y ? this.summarizeA11y(a11y, 0, this.options.maxA11yDepth) : '(unavailable)';

    // ── API calls from network summary ──
    const apiCalls = this.extractApiCalls(metadata.networkSummary);

    // ── Console errors ──
    const consoleErrors = consoleData?.errors?.slice(0, 5) || [];

    return {
      url: metadata.url,
      title: metadata.title,
      pageName,
      capturedAt: metadata.timestamp,
      elements,
      a11ySummary,
      apiCalls,
      consoleErrors,
      formFields,
    };
  }

  private extractElements(
    rawElements: any[],
    maxCount: number
  ): BundledPage['elements'] {
    if (!rawElements) return [];
    return rawElements
      .filter(e => e.computedState?.isVisible)
      .slice(0, maxCount)
      .map(e => {
        const best =
          e.locators?.find((l: any) => l.isUnique && l.strategy === 'testid') ||
          e.locators?.find((l: any) => l.isUnique && l.strategy === 'role') ||
          e.locators?.find((l: any) => l.isUnique) ||
          e.locators?.[0];

        const states: string[] = [];
        if (!e.computedState?.isEnabled) states.push('disabled');
        if (e.computedState?.isChecked) states.push('checked');
        if (e.computedState?.isEditable) states.push('editable');

        return {
          role: e.tagName,
          name: e.text?.trim().substring(0, 50) || e.attributes?.['aria-label'] || undefined,
          bestLocator: best?.value || `locator('[data-cc-element-id="${e.elementId}"]')`,
          state: states.join(', ') || 'enabled',
          position:
            e.position?.x != null && e.position?.y != null
              ? `(${e.position.x}, ${e.position.y})`
              : undefined,
        };
      });
  }

  private extractFormFields(formFields: any[], elements: any[]): BundledPage['formFields'] {
    const result: BundledPage['formFields'] = [];

    for (const field of formFields) {
      const el = elements.find(e => e.elementId === field.elementId);
      const best =
        el?.locators?.find((l: any) => l.isUnique && l.strategy === 'label') ||
        el?.locators?.find((l: any) => l.isUnique) ||
        el?.locators?.[0];

      result.push({
        label: field.label,
        type: field.fieldType || 'text',
        required: field.required || false,
        locator: best?.value || field.elementId,
      });
    }

    return result;
  }

  private summarizeA11y(node: any, depth: number, maxDepth: number): string {
    if (!node || depth > maxDepth) return '';

    const indent = '  '.repeat(depth);
    const name = node.name ? ` "${node.name.substring(0, 60)}"` : '';
    const states: string[] = [];
    if (node.required) states.push('required');
    if (node.disabled) states.push('disabled');
    if (node.checked) states.push('checked');
    if (node.expanded !== undefined) states.push(node.expanded ? 'expanded' : 'collapsed');
    const stateStr = states.length ? ` [${states.join(', ')}]` : '';

    let result = `${indent}${node.role}${name}${stateStr}\n`;

    const children = node.children || [];
    for (const child of children.slice(0, 10)) {
      result += this.summarizeA11y(child, depth + 1, maxDepth);
    }

    return result;
  }

  private extractApiCalls(networkSummary: any): BundledPage['apiCalls'] {
    if (!networkSummary?.apiEndpoints) return [];
    return networkSummary.apiEndpoints.slice(0, 15).map((ep: string) => ({
      method: 'GET/POST',
      path: ep,
    }));
  }

  // ── Private: output generation ────────────────────────────────────────────────

  private async write(pages: BundledPage[], domain: string, manifest: any): Promise<string> {
    const bundlesDir = path.join(this.outputDir, 'bundles');
    await fs.ensureDir(bundlesDir);

    const ext = this.options.format === 'json' ? 'json' : 'md';
    const outputPath = path.join(bundlesDir, `${this.options.outputFileName}.${ext}`);

    const content =
      this.options.format === 'json'
        ? this.renderJson(pages, domain, manifest)
        : this.renderMarkdown(pages, domain, manifest);

    await fs.writeFile(outputPath, content, 'utf8');
    return outputPath;
  }

  private renderJson(pages: BundledPage[], domain: string, manifest: any): string {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        contextGraphVersion: getVersion(),
        domain,
        pageCount: pages.length,
        manifest: manifest?.statistics || null,
        pages,
      },
      null,
      2
    );
  }

  private renderMarkdown(pages: BundledPage[], domain: string, manifest: any): string {
    const stats = manifest?.statistics;
    const lines: string[] = [];

    // ── Header ──
    lines.push(`# Application Context: ${domain}`);
    lines.push('');
    lines.push(
      `> **Generated by ContextGraph v${getVersion()}** — ${new Date().toLocaleString()}`
    );
    lines.push(
      `> Pages captured: **${pages.length}** | Paste this file into your AI agent as context.`
    );
    lines.push('');

    if (stats) {
      lines.push('## Session Summary');
      lines.push('');
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Total pages | ${stats.totalPages} |`);
      lines.push(`| Network requests | ${stats.totalNetworkRequests ?? 'n/a'} |`);
      lines.push(`| Screenshots | ${stats.totalScreenshots ?? 0} |`);
      lines.push(`| Storage size | ${stats.storageSize} |`);
      lines.push('');
    }

    // ── Per-page sections ──
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      lines.push(`---`);
      lines.push('');
      lines.push(`## Page ${i + 1} of ${pages.length}: ${page.title || page.pageName}`);
      lines.push('');
      lines.push(`**URL:** \`${page.url}\``);
      lines.push(`**Captured:** ${new Date(page.capturedAt).toLocaleString()}`);
      lines.push('');

      // Interactive elements
      if (page.elements.length > 0) {
        lines.push('### Interactive Elements');
        lines.push('');
        lines.push('| Element | Label/Text | Best Locator | State |');
        lines.push('|---------|------------|-------------|-------|');
        for (const el of page.elements) {
          const name = el.name ? el.name.replace(/\|/g, '\\|') : '—';
          const loc = el.bestLocator.replace(/\|/g, '\\|');
          lines.push(`| \`${el.role}\` | ${name} | \`${loc}\` | ${el.state} |`);
        }
        lines.push('');
      }

      // Form fields
      if (page.formFields.length > 0) {
        lines.push('### Form Fields');
        lines.push('');
        lines.push('| Label | Type | Required | Locator |');
        lines.push('|-------|------|----------|---------|');
        for (const field of page.formFields) {
          const label = (field.label || '—').replace(/\|/g, '\\|');
          lines.push(
            `| ${label} | \`${field.type}\` | ${field.required ? '✓' : '—'} | \`${field.locator.replace(/\|/g, '\\|')}\` |`
          );
        }
        lines.push('');
      }

      // Page structure (a11y)
      lines.push('### Page Structure (Accessibility Tree)');
      lines.push('');
      lines.push('```');
      lines.push(page.a11ySummary.trimEnd());
      lines.push('```');
      lines.push('');

      // API calls
      if (this.options.includeNetwork && page.apiCalls.length > 0) {
        lines.push('### API Calls Observed on This Page');
        lines.push('');
        for (const call of page.apiCalls) {
          lines.push(`- \`${call.method}\` \`${call.path}\``);
        }
        lines.push('');
      }

      // Console errors
      if (this.options.includeConsoleErrors && page.consoleErrors.length > 0) {
        lines.push('### ⚠️ Console Errors');
        lines.push('');
        for (const err of page.consoleErrors) {
          lines.push(`- \`${err.message.substring(0, 150)}\``);
        }
        lines.push('');
      }
    }

    // ── Prompt template ──
    lines.push('---');
    lines.push('');
    lines.push('## Ready-to-Use AI Prompt');
    lines.push('');
    lines.push(
      '> Copy everything above (from "Application Context") and paste into your AI agent, then append:'
    );
    lines.push('');
    lines.push('```');
    lines.push(`I am testing the ${domain} web application.`);
    lines.push('');
    lines.push(
      'Using the page context above, generate Playwright TypeScript tests that:'
    );
    lines.push('1. Navigate to each captured page');
    lines.push('2. Use ONLY the locators listed in the "Interactive Elements" tables');
    lines.push('3. Assert that key elements are visible and enabled');
    lines.push('4. Include a happy-path test for every form field listed');
    lines.push('5. Group tests by page using test.describe()');
    lines.push('```');
    lines.push('');

    return lines.join('\n');
  }
}
