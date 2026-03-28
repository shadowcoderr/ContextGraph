// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { getVersion } from '../utils/version';
import { PageSnapshot, PageMetadata } from '../types/capture';
import { GlobalManifest, ManifestEntry } from '../types/storage';
import { logger } from '../utils/logger';

export interface UpdateManifestExtras {
  networkRequests?: number;
  screenshots?: number;
}

export class StorageEngine {
  private outputDir: string;
  private prettyJson: boolean;
  private scriptsDir: string;
  private contentHashHistory: Map<string, string[]> = new Map(); // pageName → array of hashes
  private forceCapture: boolean = false;

  constructor(outputDir: string, prettyJson: boolean = true, forceCapture: boolean = false) {
    this.outputDir = path.resolve(outputDir);
    this.prettyJson = prettyJson;
    this.scriptsDir = path.join(this.outputDir, 'scripts');
    this.forceCapture = forceCapture;
  }

  // ── Configuration ────────────────────────────────────────────────────────────

  setForceCapture(force: boolean): void {
    this.forceCapture = force;
  }

  /**
   * Returns the absolute path to the scripts directory.
   * Used by RuntimeController to validate that spec files passed to
   * captureFromRecordedScript() reside within this directory, preventing
   * path traversal attacks.
   */
  getScriptsDir(): string {
    return this.scriptsDir;
  }

  // ── Change detection ─────────────────────────────────────────────────────────

  hasContentChanged(pageName: string, contentHash: string): boolean {
    const history = this.contentHashHistory.get(pageName);
    if (!history || history.length === 0) return true;
    return !history.includes(contentHash);
  }

  recordContentHash(pageName: string, contentHash: string): void {
    const history = this.contentHashHistory.get(pageName) || [];
    history.push(contentHash);
    if (history.length > 10) history.shift();
    this.contentHashHistory.set(pageName, history);
  }

  // ── Initialisation ────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(this.scriptsDir);
  }

  // ── Page directory resolution ─────────────────────────────────────────────────

  /**
   * Resolve the on-disk directory for a given page's metadata.
   * Mirrors the same logic used inside savePageSnapshot so callers can
   * compute the directory without needing to save first.
   */
  resolvePageDir(metadata: Pick<PageMetadata, 'domain' | 'pageName'>): string {
    const domainName = this.extractDomainName(metadata.domain);
    const pageName = metadata.pageName || 'page';
    return path.join(this.outputDir, domainName, 'pages', pageName);
  }

  // ── Script management ─────────────────────────────────────────────────────────

  async getUniqueScriptPath(url: string): Promise<string> {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/[^a-zA-Z0-9\-_.]/g, '_');

      let scriptPath = path.join(this.scriptsDir, `${hostname}.spec.ts`);
      let counter = 1;
      while (await fs.pathExists(scriptPath)) {
        scriptPath = path.join(this.scriptsDir, `${hostname}_${counter}.spec.ts`);
        counter++;
      }
      return scriptPath;
    } catch (error) {
      logger.error(`Error generating unique script path: ${(error as Error).message}`);
      return path.join(this.scriptsDir, `recording_${Date.now()}.spec.ts`);
    }
  }

  async mergeRecordedScript(url: string, recordedScriptPath: string): Promise<string> {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/[^a-zA-Z0-9\-_.]/g, '_');
    const mergedPath = path.join(this.scriptsDir, `${hostname}.spec.ts`);

    if (!(await fs.pathExists(recordedScriptPath))) {
      throw new Error(`Recorded script not found: ${recordedScriptPath}`);
    }

    const incoming = await fs.readFile(recordedScriptPath, 'utf8');
    const existing = (await fs.pathExists(mergedPath))
      ? await fs.readFile(mergedPath, 'utf8')
      : '';

    const merged = this.mergePlaywrightSpec(existing, incoming);
    await fs.writeFile(mergedPath, merged);

    if (path.resolve(recordedScriptPath) !== path.resolve(mergedPath)) {
      try {
        await fs.remove(recordedScriptPath);
      } catch (e) {
        logger.warn(`Failed to remove merged script ${recordedScriptPath}: ${(e as Error).message}`);
      }
    }

    return mergedPath;
  }

  private mergePlaywrightSpec(existing: string, incoming: string): string {
    const existingLines = existing.split(/\r?\n/);
    const incomingLines = incoming.split(/\r?\n/);

    const header: string[] = [];
    const seenHeader = new Set<string>();
    const takeHeader = (lines: string[]) => {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !/^import\s/.test(trimmed) || seenHeader.has(trimmed)) continue;
        seenHeader.add(trimmed);
        header.push(trimmed);
      }
    };

    takeHeader(existingLines);
    takeHeader(incomingLines);

    if (header.length === 0) {
      header.push("import { test, expect } from '@playwright/test';");
    }

    const extractSteps = (lines: string[]) => {
      const steps: string[] = [];
      let inTest = false;
      for (const line of lines) {
        if (!inTest) { if (/^\s*test\(/.test(line)) inTest = true; continue; }
        if (/^\s*\}\);\s*$/.test(line)) break;
        const trimmed = line.trimEnd();
        if (!trimmed.trim() || /^\s*\/\//.test(trimmed)) continue;
        steps.push(trimmed);
      }
      return steps;
    };

    const existingSteps = extractSteps(existingLines);
    const incomingSteps = extractSteps(incomingLines);

    const mergedSteps: string[] = [];
    const seenSteps = new Set<string>();
    const addSteps = (steps: string[]) => {
      for (const step of steps) {
        const key = step.trim();
        if (seenSteps.has(key)) continue;
        seenSteps.add(key);
        mergedSteps.push(step);
      }
    };

    addSteps(existingSteps);
    addSteps(incomingSteps);

    const indent = (s: string) => (s.startsWith('  ') ? s : `  ${s.trimStart()}`);

    return [
      ...header,
      '',
      "test('test', async ({ page }) => {",
      ...mergedSteps.map(indent),
      '});',
      '',
    ].join('\n');
  }

  // ── Snapshot persistence ──────────────────────────────────────────────────────

  async savePageSnapshot(snapshot: PageSnapshot): Promise<void> {
    const domain = snapshot.metadata.domain;
    let pageName = snapshot.metadata.pageName || 'page';
    const contentHash = snapshot.metadata.contentHash || '';

    const domainName = this.extractDomainName(domain);
    let pageDir = path.join(this.outputDir, domainName, 'pages', pageName);

    const shouldSave = this.forceCapture || this.hasContentChanged(pageName, contentHash);

    if (!shouldSave) {
      logger.info(`Skipping save for ${pageName}: content unchanged (hash: ${contentHash})`);
      return;
    }

    logger.info(
      `Saving page snapshot: domain=${domainName}, page=${pageName}, url=${snapshot.metadata.url}`
    );

    try {
      await fs.ensureDir(pageDir);
    } catch (error) {
      const msg = (error as Error).message;
      logger.warn(`Failed to create directory '${pageDir}': ${msg}. Attempting fallback...`);
      
      // Fallback: Use a shorter, safe name with a hash if the original name fails (likely due to length or invalid chars)
      const safeHash = crypto.createHash('md5').update(snapshot.metadata.url).digest('hex').substring(0, 8);
      pageName = `page-${safeHash}`;
      pageDir = path.join(this.outputDir, domainName, 'pages', pageName);
      
      // Update metadata so it's consistent with the actual folder name
      snapshot.metadata.pageName = pageName;
      
      logger.info(`Using fallback directory: ${pageDir}`);
      await fs.ensureDir(pageDir);
    }

    if (contentHash) {
      this.recordContentHash(pageName, contentHash);
    }

    // ── Core files ──
    await this.writeJson(path.join(pageDir, 'metadata.json'), snapshot.metadata);
    await fs.writeFile(path.join(pageDir, 'DOM'), this.beautifyHTML(snapshot.domSnapshot));
    await this.writeJson(path.join(pageDir, 'a11y_tree.json'), snapshot.a11yTree);
    await this.writeJson(path.join(pageDir, 'locators.json'), snapshot.locators);

    // ── Frames ──
    await this.saveFrames(snapshot, pageDir);

    // ── Console errors / warnings ──
    const consoleErrors = {
      errors: snapshot.consoleMessages
        .filter((m: any) => m.type === 'error')
        .map((m: any) => ({
          timestamp: m.timestamp,
          message: m.message,
          source: `${m.location?.url || ''}:${m.location?.lineNumber || 0}:${m.location?.columnNumber || 0}`,
          stack: m.stack,
        })),
      warnings: snapshot.consoleMessages
        .filter((m: any) => m.type === 'warn')
        .map((m: any) => ({
          timestamp: m.timestamp,
          message: m.message,
          source: `${m.location?.url || ''}:${m.location?.lineNumber || 0}:${m.location?.columnNumber || 0}`,
        })),
    };

    if (consoleErrors.errors.length > 0 || consoleErrors.warnings.length > 0) {
      await this.writeJson(path.join(pageDir, 'console_errors.json'), consoleErrors);
    }

    // ── Screenshot paths (written into metadata after screenshot capture) ──
    if (snapshot.screenshotPaths.length > 0) {
      await this.writeJson(
        path.join(pageDir, 'screenshot_manifest.json'),
        {
          capturedAt: new Date().toISOString(),
          paths: snapshot.screenshotPaths,
          count: snapshot.screenshotPaths.length,
        }
      );
    }

    // ── Network events (save summary) ──
    if (snapshot.networkEvents.length > 0) {
      const networkDir = path.join(this.outputDir, domainName, 'network');
      await fs.ensureDir(networkDir);

      const trafficLog = path.join(networkDir, 'traffic_log.jsonl');
      const lines = snapshot.networkEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(trafficLog, lines);
    }

    logger.info(`Saved page snapshot: ${pageName}`);
  }

  private async saveFrames(snapshot: PageSnapshot, pageDir: string): Promise<void> {
    await this.writeJson(path.join(pageDir, 'frames.json'), snapshot.frames);

    const framesDir = path.join(pageDir, 'frames');
    await fs.ensureDir(framesDir);

    let frameCounter = 0;
    const writeFrame = async (frame: any): Promise<void> => {
      const id = `frame_${String(frameCounter++).padStart(3, '0')}`;
      if (frame?.content) {
        const filename = path.join(
          framesDir,
          `${id}_${(frame.name || 'main').replace(/[^a-z0-9\-_.]/gi, '_')}.html`
        );
        await fs.writeFile(filename, frame.content);
        frame.contentFile = path.relative(pageDir, filename).replace(/\\/g, '/');
      }
      if (frame?.children?.length) {
        for (const child of frame.children) await writeFrame(child);
      }
    };

    if (snapshot.frames) {
      await writeFrame(snapshot.frames).catch(err =>
        logger.warn('Failed to write frame contents: ' + (err as Error).message)
      );
      await this.writeJson(path.join(pageDir, 'frames.json'), snapshot.frames);
    }
  }

  // ── Components registry ────────────────────────────────────────────────────────

  async saveComponentsRegistry(registry: any, domainName: string): Promise<void> {
    const registryPath = path.join(this.outputDir, domainName, 'components_registry.json');
    await fs.ensureDir(path.dirname(registryPath));
    await this.writeJson(registryPath, registry);
    logger.info(`Saved components registry to ${registryPath}`);
  }

  async updateManifestWithComponents(domainName: string, totalComponents: number): Promise<void> {
    const manifestPath = path.join(this.outputDir, 'global_manifest.json');
    if (!(await fs.pathExists(manifestPath))) return;

    const manifest = await fs.readJson(manifestPath);
    manifest.componentsRegistry = {
      path: `${domainName}/components_registry.json`,
      totalComponents,
      lastUpdated: new Date().toISOString(),
    };
    manifest.statistics.totalComponents = totalComponents;
    manifest.lastUpdated = new Date().toISOString();
    await this.writeJson(manifestPath, manifest);
  }

  // ── Global manifest ────────────────────────────────────────────────────────────

  async updateGlobalManifest(
    entry: ManifestEntry,
    extras: UpdateManifestExtras = {}
  ): Promise<void> {
    const manifestPath = path.join(this.outputDir, 'global_manifest.json');
    let manifest: GlobalManifest;

    if (await fs.pathExists(manifestPath)) {
      manifest = await fs.readJson(manifestPath);
    } else {
      manifest = {
        version: getVersion(),
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        sessions: [],
        domains: [],
        statistics: {
          totalSessions: 0,
          totalDomains: 0,
          totalPages: 0,
          totalNetworkRequests: 0,
          totalScreenshots: 0,
          storageSize: '0 KB',
        },
      };
    }

    // ── Update domains ──
    let domainEntry = manifest.domains.find(d => d.domain === entry.domain);
    if (!domainEntry) {
      domainEntry = {
        domain: entry.domain,
        firstVisited: entry.timestamp,
        lastVisited: entry.timestamp,
        totalVisits: 0,
        pages: [],
      };
      manifest.domains.push(domainEntry);
    }

    domainEntry.lastVisited = entry.timestamp;
    domainEntry.totalVisits++;
    domainEntry.pages.push(entry);

    // ── Update statistics ──
    manifest.statistics.totalDomains = manifest.domains.length;
    manifest.statistics.totalPages = manifest.domains.reduce((sum, d) => sum + d.pages.length, 0);
    manifest.statistics.totalNetworkRequests =
      (manifest.statistics.totalNetworkRequests || 0) + (extras.networkRequests ?? 0);
    manifest.statistics.totalScreenshots =
      (manifest.statistics.totalScreenshots || 0) + (extras.screenshots ?? 0);

    // Compute actual storage size (non-blocking — best effort)
    try {
      const bytes = await this.computeDirectorySizeBytes(this.outputDir);
      manifest.statistics.storageSize = this.formatBytes(bytes);
    } catch {
      // Leave existing value if directory walk fails
    }

    manifest.lastUpdated = new Date().toISOString();
    await this.writeJson(manifestPath, manifest);
  }

  // ── User interactions ──────────────────────────────────────────────────────────

  async saveUserInteractions(url: string, interactions: any[]): Promise<void> {
    try {
      const urlObj = new URL(url);
      const domainName = this.extractDomainName(urlObj.hostname);
      const domainDir = path.join(this.outputDir, domainName);
      const interactionsFile = path.join(domainDir, 'user_interactions.json');

      await fs.ensureDir(domainDir);

      let existing: any[] = [];
      if (await fs.pathExists(interactionsFile)) {
        existing = await fs.readJson(interactionsFile);
      }

      const stamped = interactions.map(i => ({
        ...i,
        pageUrl: url,
        recordedAt: new Date().toISOString(),
      }));

      await this.writeJson(interactionsFile, [...existing, ...stamped]);
      logger.info(`Saved ${interactions.length} user interactions to ${interactionsFile}`);
    } catch (error) {
      logger.error(`Failed to save user interactions: ${(error as Error).message}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────────

  private extractDomainName(domain: string): string {
    const parts = domain.split('.');
    const filtered = parts.filter(p => p.toLowerCase() !== 'www');
    if (filtered.length >= 2) return filtered[filtered.length - 2];
    return filtered[0] || parts[0];
  }

  private async writeJson(filePath: string, data: any): Promise<void> {
    const jsonString = this.prettyJson
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    await fs.writeFile(filePath, jsonString);
  }

  /**
   * Recursively walk a directory and sum all file sizes in bytes.
   * Returns 0 if the directory does not exist.
   */
  private async computeDirectorySizeBytes(dir: string): Promise<number> {
    if (!(await fs.pathExists(dir))) return 0;

    let total = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await this.computeDirectorySizeBytes(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch {
          // File may have been removed during iteration
        }
      }
    }

    return total;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * Beautify HTML by adding proper indentation and line breaks.
   * Self-closing / void elements are handled correctly so the indent
   * level is never corrupted by unclosed tags.
   */
  private beautifyHTML(html: string): string {
    try {
      if (!html?.trim()) return html;

      const parts: string[] = [];
      const tagRegex = /(<[^>]+>)/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = tagRegex.exec(html)) !== null) {
        if (match.index > lastIndex) {
          const text = html.substring(lastIndex, match.index).trim();
          if (text) parts.push(text);
        }
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < html.length) {
        const text = html.substring(lastIndex).trim();
        if (text) parts.push(text);
      }

      const indentSize = 2;
      let indent = 0;
      const result: string[] = [];
      const voidElements = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr', 'noscript',
      ]);

      for (const part of parts) {
        const p = part.trim();
        if (!p) continue;

        if (p.startsWith('<!DOCTYPE')) {
          result.push(p);
        } else if (p.startsWith('<!--')) {
          result.push(' '.repeat(indent) + p);
        } else if (p.startsWith('</')) {
          indent = Math.max(0, indent - indentSize);
          result.push(' '.repeat(indent) + p);
        } else if (p.startsWith('<')) {
          const tagName = p.match(/^<(\w+)/)?.[1]?.toLowerCase();
          const isSelfClosing = p.endsWith('/>') || (tagName && voidElements.has(tagName));
          result.push(' '.repeat(indent) + p);
          if (!isSelfClosing && tagName !== 'script' && tagName !== 'style') {
            indent += indentSize;
          }
        } else {
          for (const line of p.split(/\n/).filter(l => l.trim())) {
            result.push(' '.repeat(indent) + line.trim());
          }
        }
      }

      return result.join('\n');
    } catch (error) {
      logger.warn('HTML beautification failed, using original: ' + (error as Error).message);
      return html;
    }
  }
}
