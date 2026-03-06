// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';
import * as path from 'path';
import { PageSnapshot } from '../types/capture';
import { GlobalManifest, ManifestEntry } from '../types/storage';
import { logger } from '../utils/logger';

export class StorageEngine {
  private outputDir: string;
  private prettyJson: boolean;
  private scriptsDir: string;
  private contentHashHistory: Map<string, string[]> = new Map(); // pageName -> array of hashes
  private forceCapture: boolean = false;

  constructor(outputDir: string, prettyJson: boolean = true, forceCapture: boolean = false) {
    this.outputDir = path.resolve(outputDir);
    this.prettyJson = prettyJson;
    this.scriptsDir = path.join(this.outputDir, 'scripts');
    this.forceCapture = forceCapture;
  }

  /**
   * Set force capture mode - always write artifacts even if content hash unchanged
   */
  setForceCapture(force: boolean): void {
    this.forceCapture = force;
  }

  /**
   * Check if content has changed since last capture
   */
  hasContentChanged(pageName: string, contentHash: string): boolean {
    const history = this.contentHashHistory.get(pageName);
    if (!history || history.length === 0) return true;
    return !history.includes(contentHash);
  }

  /**
   * Record content hash for a page
   */
  recordContentHash(pageName: string, contentHash: string): void {
    const history = this.contentHashHistory.get(pageName) || [];
    history.push(contentHash);
    // Keep last 10 hashes per page
    if (history.length > 10) history.shift();
    this.contentHashHistory.set(pageName, history);
  }

  async initialize(): Promise<void> {
    // Create the root output directory and scripts directory
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(this.scriptsDir);
  }

  async getUniqueScriptPath(url: string): Promise<string> {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/[^a-zA-Z0-9\-_.]/g, '_'); // Sanitize hostname
      
      let scriptPath = path.join(this.scriptsDir, `${hostname}.spec.ts`);
      let counter = 1;
      
      // Check if file exists and increment counter if needed
      while (await fs.pathExists(scriptPath)) {
        scriptPath = path.join(this.scriptsDir, `${hostname}_${counter}.spec.ts`);
        counter++;
      }
      
      return scriptPath;
    } catch (error) {
      logger.error(`Error generating unique script path: ${(error as Error).message}`);
      // Fallback to a timestamp-based name
      const timestamp = Date.now();
      return path.join(this.scriptsDir, `recording_${timestamp}.spec.ts`);
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
    const existing = (await fs.pathExists(mergedPath)) ? await fs.readFile(mergedPath, 'utf8') : '';

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
        if (!trimmed) continue;
        if (!/^import\s/.test(trimmed)) continue;
        if (seenHeader.has(trimmed)) continue;
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
        if (!inTest) {
          if (/^\s*test\(/.test(line)) {
            inTest = true;
          }
          continue;
        }

        if (/^\s*\}\);\s*$/.test(line)) {
          break;
        }

        const trimmed = line.trimEnd();
        if (!trimmed.trim()) continue;
        if (/^\s*\/\//.test(trimmed)) continue;

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

  async savePageSnapshot(snapshot: PageSnapshot): Promise<void> {
    const domain = snapshot.metadata.domain;
    const pageName = snapshot.metadata.pageName || 'page';
    const contentHash = snapshot.metadata.contentHash || '';

    // Derive logical domain name (e.g., www.saucedemo.com -> saucedemo, saucedemo.com -> saucedemo)
    const domainName = (() => {
      const parts = domain.split('.');
      // Remove 'www' prefix if present
      const filtered = parts.filter(p => p.toLowerCase() !== 'www');
      // Get the main domain name (second-to-last part, or first if only one part)
      if (filtered.length >= 2) {
        return filtered[filtered.length - 2];
      }
      return filtered[0] || parts[0];
    })();

    const domainDir = path.join(this.outputDir, domainName);
    const pageDir = path.join(domainDir, 'pages', pageName);
    
    // Check if we should save (force capture or content changed)
    const shouldSave = this.forceCapture || this.hasContentChanged(pageName, contentHash);
    
    if (!shouldSave) {
      logger.info(`Skipping save for ${pageName}: content unchanged (hash: ${contentHash})`);
      return;
    }
    
    logger.info(`Saving page snapshot: domain=${domainName}, page=${pageName}, url=${snapshot.metadata.url}, forceCapture=${this.forceCapture}`);

    await fs.ensureDir(pageDir);

    // Record the content hash
    if (contentHash) {
      this.recordContentHash(pageName, contentHash);
    }

    // Save metadata
    await this.writeJson(path.join(pageDir, 'metadata.json'), snapshot.metadata);

    // Save DOM snapshot as 'DOM' file (beautified)
    const beautifiedDOM = this.beautifyHTML(snapshot.domSnapshot);
    await fs.writeFile(path.join(pageDir, 'DOM'), beautifiedDOM);

    // Save accessibility tree
    await this.writeJson(path.join(pageDir, 'a11y_tree.json'), snapshot.a11yTree);

    // Save locators
    await this.writeJson(path.join(pageDir, 'locators.json'), snapshot.locators);

    // Save frames
    await this.writeJson(path.join(pageDir, 'frames.json'), snapshot.frames);
    // Save serialized frame contents as separate files where present
    const framesDir = path.join(pageDir, 'frames');
    await fs.ensureDir(framesDir);

    let frameCounter = 0;
    const writeFrame = async (frame: any) => {
      const id = `frame_${String(frameCounter++).padStart(3, '0')}`;
      if (frame && frame.content) {
        const filename = path.join(framesDir, `${id}_${(frame.name || 'main').replace(/[^a-z0-9\-_.]/gi, '_')}.html`);
        await fs.writeFile(filename, frame.content);
        // Replace content with relative path reference to keep JSON small
        frame.contentFile = path.relative(pageDir, filename).replace(/\\/g, '/');
      }
      if (frame && frame.children && frame.children.length > 0) {
        for (const child of frame.children) {
          await writeFrame(child);
        }
      }
    };

    try {
      if (snapshot.frames) {
        await writeFrame(snapshot.frames);
        // Rewrite frames.json to include contentFile references
        await this.writeJson(path.join(pageDir, 'frames.json'), snapshot.frames);
      }
    } catch (err) {
      logger.warn('Failed to write frame contents: ' + (err as Error).message);
    }

    // Save console errors and warnings (separate file)
    const consoleErrors = {
      errors: snapshot.consoleMessages
        .filter((msg: any) => msg.type === 'error')
        .map((msg: any) => ({
          timestamp: msg.timestamp,
          message: msg.message,
          source: `${msg.location?.url || ''}:${msg.location?.lineNumber || 0}:${msg.location?.columnNumber || 0}`,
          stack: msg.stack,
        })),
      warnings: snapshot.consoleMessages
        .filter((msg: any) => msg.type === 'warn')
        .map((msg: any) => ({
          timestamp: msg.timestamp,
          message: msg.message,
          source: `${msg.location?.url || ''}:${msg.location?.lineNumber || 0}:${msg.location?.columnNumber || 0}`,
        })),
    };
    
    if (consoleErrors.errors.length > 0 || consoleErrors.warnings.length > 0) {
      await this.writeJson(path.join(pageDir, 'console_errors.json'), consoleErrors);
    }

    logger.info(`Saved page snapshot: ${pageName}`);
  }

  /**
   * Save the components registry and update manifest reference
   */
  async saveComponentsRegistry(registry: any, domainName: string): Promise<void> {
    const registryPath = path.join(this.outputDir, domainName, 'components_registry.json');
    await fs.ensureDir(path.dirname(registryPath));
    await this.writeJson(registryPath, registry);
    logger.info(`Saved components registry to ${registryPath}`);
  }

  /**
   * Update manifest with components registry reference
   */
  async updateManifestWithComponents(domainName: string, totalComponents: number): Promise<void> {
    const manifestPath = path.join(this.outputDir, 'global_manifest.json');
    
    if (await fs.pathExists(manifestPath)) {
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
  }

  async updateGlobalManifest(entry: ManifestEntry): Promise<void> {
    const manifestPath = path.join(this.outputDir, 'global_manifest.json');
    let manifest: GlobalManifest;

    if (await fs.pathExists(manifestPath)) {
      manifest = await fs.readJson(manifestPath);
    } else {
      manifest = {
        version: '0.3.0',
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
          storageSize: '0 MB',
        },
      };
    }

    // Update domains
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

    // Update statistics
    manifest.statistics.totalPages = manifest.domains.reduce((sum, d) => sum + d.pages.length, 0);
    manifest.lastUpdated = new Date().toISOString();

    await this.writeJson(manifestPath, manifest);
  }

  private async writeJson(filePath: string, data: any): Promise<void> {
    const jsonString = this.prettyJson
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    await fs.writeFile(filePath, jsonString);
  }

  /**
   * Beautify HTML by adding proper indentation and line breaks
   * This makes the DOM more readable for RAG/context analysis
   * Properly handles self-closing tags and preserves HTML structure
   */
  async saveUserInteractions(url: string, interactions: any[]): Promise<void> {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      
      // Derive logical domain name
      const domainName = (() => {
        const parts = domain.split('.');
        const filtered = parts.filter(p => p.toLowerCase() !== 'www');
        if (filtered.length >= 2) {
          return filtered[filtered.length - 2];
        }
        return filtered[0] || parts[0];
      })();
      
      const domainDir = path.join(this.outputDir, domainName);
      const interactionsFile = path.join(domainDir, 'user_interactions.json');
      
      await fs.ensureDir(domainDir);
      
      // Load existing interactions or create new array
      let existingInteractions: any[] = [];
      if (await fs.pathExists(interactionsFile)) {
        existingInteractions = await fs.readJson(interactionsFile);
      }
      
      // Add new interactions with page URL
      const interactionsWithUrl = interactions.map(interaction => ({
        ...interaction,
        pageUrl: url,
        recordedAt: new Date().toISOString()
      }));
      
      // Merge with existing interactions
      const allInteractions = [...existingInteractions, ...interactionsWithUrl];
      
      // Save all interactions
      await this.writeJson(interactionsFile, allInteractions);
      logger.info(`Saved ${interactions.length} user interactions to ${interactionsFile}`);
      
    } catch (error) {
      logger.error(`Failed to save user interactions: ${(error as Error).message}`);
    }
  }

  private beautifyHTML(html: string): string {
    try {
      if (!html || html.trim().length === 0) {
        return html;
      }

      // Use a proper HTML parser approach - format with indentation
      // Split by tags while preserving them
      const parts: string[] = [];
      const tagRegex = /(<[^>]+>)/g;
      let lastIndex = 0;
      let match;

      while ((match = tagRegex.exec(html)) !== null) {
        // Add text before tag
        if (match.index > lastIndex) {
          const text = html.substring(lastIndex, match.index).trim();
          if (text) parts.push(text);
        }
        // Add tag
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
      }
      // Add remaining text
      if (lastIndex < html.length) {
        const text = html.substring(lastIndex).trim();
        if (text) parts.push(text);
      }

      const indentSize = 2;
      let indent = 0;
      const result: string[] = [];
      const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'noscript']);

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;

        if (part.startsWith('<!DOCTYPE')) {
          result.push(part);
        } else if (part.startsWith('<!--')) {
          result.push(' '.repeat(indent) + part);
        } else if (part.startsWith('</')) {
          // Closing tag
          indent = Math.max(0, indent - indentSize);
          result.push(' '.repeat(indent) + part);
        } else if (part.startsWith('<')) {
          // Opening tag
          const tagName = part.match(/^<(\w+)/)?.[1]?.toLowerCase();
          const isSelfClosing = part.endsWith('/>') || (tagName && voidElements.has(tagName));
          
          result.push(' '.repeat(indent) + part);
          
          if (!isSelfClosing && tagName !== 'script' && tagName !== 'style') {
            indent += indentSize;
          }
        } else {
          // Text content
          const lines = part.split(/\n/).filter(l => l.trim());
          for (const line of lines) {
            if (line.trim()) {
              result.push(' '.repeat(indent) + line.trim());
            }
          }
        }
      }

      return result.join('\n');
    } catch (error) {
      // If beautification fails, return original
      logger.warn('HTML beautification failed, using original: ' + (error as Error).message);
      return html;
    }
  }
}
