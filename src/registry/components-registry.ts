// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  ComponentsRegistry,
  ComponentPattern,
  ComponentOccurrence,
  ComponentSignature,
  ComponentType,
  ComponentExtractionOptions,
  ExtractedComponent,
} from '../types/registry';
import { Locator, PageSnapshot } from '../types/capture';
import { logger } from '../utils/logger';

const DEFAULT_EXTRACTION_OPTIONS: ComponentExtractionOptions = {
  minOccurrences: 1,
  stabilityThreshold: 50,
  includeContext: true,
  maxComponents: 1000,
};

/**
 * Components Registry Manager
 * Tracks reusable UI component patterns across captured pages
 */
export class ComponentsRegistryManager {
  private registry: ComponentsRegistry;
  private registryPath: string;
  private options: ComponentExtractionOptions;

  constructor(outputDir: string, domain: string, options?: Partial<ComponentExtractionOptions>) {
    this.registryPath = path.join(outputDir, 'components_registry.json');
    this.options = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };
    this.registry = this.createEmptyRegistry(domain);
  }

  /**
   * Initialize or load existing registry
   */
  async initialize(): Promise<void> {
    if (await fs.pathExists(this.registryPath)) {
      try {
        const loaded = await fs.readJson(this.registryPath);
        this.registry = loaded;
        logger.info(`Loaded existing components registry with ${this.registry.components.length} components`);
      } catch (error) {
        logger.warn(`Failed to load existing registry, creating new one: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Extract components from a page snapshot and update registry
   */
  async processPage(snapshot: PageSnapshot): Promise<ExtractedComponent[]> {
    const extractedComponents = this.extractComponents(snapshot);
    
    for (const extracted of extractedComponents) {
      await this.registerComponent(extracted, snapshot);
    }

    // Update statistics
    this.updateStatistics();
    
    return extractedComponents;
  }

  /**
   * Extract potential components from a page snapshot
   */
  private extractComponents(snapshot: PageSnapshot): ExtractedComponent[] {
    const extracted: ExtractedComponent[] = [];
    const locatorsData = snapshot.locators;

    for (const element of locatorsData.elements) {
      // Only consider elements with unique locators
      const uniqueLocators = element.locators.filter((l: Locator) => l.isUnique);
      if (uniqueLocators.length === 0) continue;

      const signature = this.computeSignature(element);

      extracted.push({
        elementId: element.elementId,
        tagName: element.tagName,
        role: element.attributes.role,
        text: element.text || '',
        locators: uniqueLocators,
        attributes: element.attributes,
        signature,
      });
    }

    return extracted;
  }

  /**
   * Compute a signature for identifying similar components
   */
  private computeSignature(element: any): ComponentSignature {
    const signature: ComponentSignature = {
      tagName: element.tagName,
      role: element.attributes?.role,
      classes: [],
      attributes: {},
      structureHash: this.computeStructureHash(element),
    };

    // Extract stable classes (filter out dynamic ones)
    if (element.attributes?.class) {
      const classes = element.attributes.class.split(' ').filter((c: string) => 
        !c.match(/^(active|disabled|selected|hover|focus|open|closed|loading|error|success)$/i) &&
        !c.match(/[0-9]{3,}/) && // Exclude classes with long numbers (likely dynamic)
        c.length > 2
      );
      signature.classes = classes.slice(0, 5); // Limit to 5 classes
    }

    // Extract stable attributes
    const stableAttrs = ['type', 'name', 'data-testid', 'data-test', 'aria-label', 'placeholder'];
    for (const attr of stableAttrs) {
      if (element.attributes?.[attr]) {
        if (!signature.attributes) signature.attributes = {};
        signature.attributes[attr] = element.attributes[attr];
      }
    }

    return signature;
  }

  /**
   * Compute a hash of the element structure for comparison
   */
  private computeStructureHash(element: any): string {
    const structure = {
      tag: element.tagName,
      role: element.attributes?.role,
      type: element.attributes?.type,
    };
    return crypto.createHash('md5').update(JSON.stringify(structure)).digest('hex').substring(0, 8);
  }

  /**
   * Infer component type from element properties
   */
  private inferComponentType(element: any): ComponentType {
    const tagName = element.tagName?.toLowerCase();
    const role = element.attributes?.role?.toLowerCase();
    const type = element.attributes?.type?.toLowerCase();

    // Role-based detection
    if (role === 'navigation' || role === 'menu') return 'navigation';
    if (role === 'dialog' || role === 'alertdialog') return 'modal';
    if (role === 'search') return 'search';
    if (role === 'banner') return 'header';
    if (role === 'contentinfo') return 'footer';

    // Tag-based detection
    if (tagName === 'nav') return 'navigation';
    if (tagName === 'header') return 'header';
    if (tagName === 'footer') return 'footer';
    if (tagName === 'aside') return 'sidebar';
    if (tagName === 'form') return 'form';
    if (tagName === 'table') return 'table';
    if (tagName === 'ul' || tagName === 'ol') return 'list';
    if (tagName === 'article' || tagName === 'section') return 'card';

    // Input type detection
    if (tagName === 'input') {
      if (type === 'search') return 'search';
      if (type === 'submit' || type === 'button') return 'button';
      return 'input';
    }

    if (tagName === 'select') return 'select';
    if (tagName === 'textarea') return 'input';
    if (tagName === 'button') return 'button';
    if (tagName === 'a') return 'link';

    // Text-based detection
    const text = element.text?.toLowerCase() || '';
    if (text.includes('login') || text.includes('sign in')) return 'login';
    if (text.includes('search')) return 'search';
    if (text.includes('previous') || text.includes('next') || text.includes('page')) return 'pagination';
    if (text.includes('breadcrumb')) return 'breadcrumb';

    return 'custom';
  }

  /**
   * Register a component in the registry
   */
  private async registerComponent(extracted: ExtractedComponent, snapshot: PageSnapshot): Promise<void> {
    // Find existing component with matching signature
    const existingComponent = this.findMatchingComponent(extracted.signature);

    if (existingComponent) {
      // Add occurrence to existing component
      this.addOccurrence(existingComponent, extracted, snapshot);
    } else {
      // Create new component pattern
      if (this.registry.components.length < this.options.maxComponents) {
        this.createNewComponent(extracted, snapshot);
      }
    }
  }

  /**
   * Find a component matching the given signature
   */
  private findMatchingComponent(signature: ComponentSignature): ComponentPattern | undefined {
    return this.registry.components.find(c => {
      // Match by structure hash
      if (c.signature.structureHash && signature.structureHash && 
          c.signature.structureHash === signature.structureHash) {
        return true;
      }

      // Match by role and tag
      if (c.signature.role && signature.role && c.signature.role === signature.role &&
          c.signature.tagName === signature.tagName) {
        return true;
      }

      // Match by test ID pattern
      if (c.signature.attributes?.['data-testid'] && signature.attributes?.['data-testid']) {
        return c.signature.attributes['data-testid'] === signature.attributes['data-testid'];
      }

      return false;
    });
  }

  /**
   * Add an occurrence to an existing component
   */
  private addOccurrence(component: ComponentPattern, extracted: ExtractedComponent, snapshot: PageSnapshot): void {
    const bestLocator = this.selectBestLocator(extracted.locators);
    
    const occurrence: ComponentOccurrence = {
      pageId: snapshot.metadata.captureId,
      pageUrl: snapshot.metadata.url,
      timestamp: snapshot.metadata.timestamp,
      elementId: extracted.elementId,
      locator: bestLocator,
    };

    component.occurrences.push(occurrence);
    component.metadata.lastSeen = snapshot.metadata.timestamp;
    component.metadata.totalOccurrences++;
    
    // Update unique pages count
    const uniquePages = new Set(component.occurrences.map(o => o.pageId));
    component.metadata.uniquePages = uniquePages.size;

    // Update best locators if we found a better one
    this.updateBestLocators(component, extracted.locators);
  }

  /**
   * Create a new component pattern
   */
  private createNewComponent(extracted: ExtractedComponent, snapshot: PageSnapshot): void {
    const componentType = this.inferComponentType(extracted);
    const bestLocator = this.selectBestLocator(extracted.locators);

    const component: ComponentPattern = {
      componentId: `comp_${this.registry.components.length.toString().padStart(4, '0')}`,
      name: this.generateComponentName(extracted, componentType),
      type: componentType,
      signature: extracted.signature,
      occurrences: [{
        pageId: snapshot.metadata.captureId,
        pageUrl: snapshot.metadata.url,
        timestamp: snapshot.metadata.timestamp,
        elementId: extracted.elementId,
        locator: bestLocator,
      }],
      bestLocators: extracted.locators.slice(0, 3),
      metadata: {
        firstSeen: snapshot.metadata.timestamp,
        lastSeen: snapshot.metadata.timestamp,
        totalOccurrences: 1,
        uniquePages: 1,
        avgStability: this.calculateStability(extracted.locators),
        tags: [componentType],
        description: this.generateDescription(extracted, componentType),
      },
    };

    this.registry.components.push(component);
    logger.debug(`Created new component: ${component.name} (${component.componentId})`);
  }

  /**
   * Select the best locator from candidates
   */
  private selectBestLocator(locators: Locator[]): Locator {
    // Prefer unique locators with high resilience
    const sorted = [...locators].sort((a, b) => {
      // Prioritize unique locators
      if (a.isUnique && !b.isUnique) return -1;
      if (!a.isUnique && b.isUnique) return 1;
      
      // Then by resilience
      return (b.resilience || 0) - (a.resilience || 0);
    });

    return sorted[0];
  }

  /**
   * Update best locators if we find better ones
   */
  private updateBestLocators(component: ComponentPattern, newLocators: Locator[]): void {
    const allLocators = [...component.bestLocators, ...newLocators];
    
    // Deduplicate by strategy and value
    const uniqueLocators = new Map<string, Locator>();
    for (const locator of allLocators) {
      const key = `${locator.strategy}:${locator.value}`;
      if (!uniqueLocators.has(key) || (locator.isUnique && !uniqueLocators.get(key)?.isUnique)) {
        uniqueLocators.set(key, locator);
      }
    }

    // Sort and take top 3
    component.bestLocators = Array.from(uniqueLocators.values())
      .sort((a, b) => {
        if (a.isUnique && !b.isUnique) return -1;
        if (!a.isUnique && b.isUnique) return 1;
        return (b.resilience || 0) - (a.resilience || 0);
      })
      .slice(0, 3);

    // Update average stability
    component.metadata.avgStability = this.calculateStability(component.bestLocators);
  }

  /**
   * Calculate average stability score for locators
   */
  private calculateStability(locators: Locator[]): number {
    if (locators.length === 0) return 0;
    
    const stabilityScores = locators.map(l => {
      let score = l.resilience || 50;
      if (l.isUnique) score += 20;
      if (l.matchCount === 1) score += 10;
      return Math.min(100, score);
    });

    return Math.round(stabilityScores.reduce((a, b) => a + b, 0) / stabilityScores.length);
  }

  /**
   * Generate a human-readable component name
   */
  private generateComponentName(extracted: ExtractedComponent, type: ComponentType): string {
    // Try to use text content
    if (extracted.text && extracted.text.length < 30) {
      return `${type}_${extracted.text.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }

    // Try to use test ID
    if (extracted.attributes['data-testid']) {
      return `${type}_${extracted.attributes['data-testid'].toLowerCase()}`;
    }

    // Try to use aria-label
    if (extracted.attributes['aria-label']) {
      return `${type}_${extracted.attributes['aria-label'].toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }

    // Fallback to tag and role
    const role = extracted.role || extracted.attributes.role || 'unknown';
    return `${type}_${extracted.tagName}_${role}`.toLowerCase();
  }

  /**
   * Generate a description for the component
   */
  private generateDescription(extracted: ExtractedComponent, type: ComponentType): string {
    const parts: string[] = [`${type} component`];
    
    if (extracted.text) {
      parts.push(`with text "${extracted.text.substring(0, 50)}"`);
    }
    
    if (extracted.attributes['data-testid']) {
      parts.push(`(testid: ${extracted.attributes['data-testid']})`);
    }

    return parts.join(' ');
  }

  /**
   * Update registry statistics
   */
  private updateStatistics(): void {
    const stats = this.registry.statistics;
    
    stats.totalComponents = this.registry.components.length;
    stats.totalOccurrences = this.registry.components.reduce(
      (sum, c) => sum + c.metadata.totalOccurrences, 0
    );

    // Count by type
    stats.byType = {} as any;
    for (const component of this.registry.components) {
      stats.byType[component.type] = (stats.byType[component.type] || 0) + 1;
    }

    // Calculate average stability
    if (this.registry.components.length > 0) {
      stats.avgStability = Math.round(
        this.registry.components.reduce((sum, c) => sum + c.metadata.avgStability, 0) /
        this.registry.components.length
      );
    }

    // Find most common components
    stats.mostCommon = this.registry.components
      .sort((a, b) => b.metadata.totalOccurrences - a.metadata.totalOccurrences)
      .slice(0, 10)
      .map(c => c.componentId);

    this.registry.lastUpdated = new Date().toISOString();
  }

  /**
   * Save the registry to disk
   */
  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.registryPath));
    await fs.writeJson(this.registryPath, this.registry, { spaces: 2 });
    logger.info(`Saved components registry to ${this.registryPath}`);
  }

  /**
   * Get the current registry
   */
  getRegistry(): ComponentsRegistry {
    return this.registry;
  }

  /**
   * Find components by type
   */
  getComponentsByType(type: ComponentType): ComponentPattern[] {
    return this.registry.components.filter(c => c.type === type);
  }

  /**
   * Find components that appear on a specific page
   */
  getComponentsByPage(pageId: string): ComponentPattern[] {
    return this.registry.components.filter(c => 
      c.occurrences.some(o => o.pageId === pageId)
    );
  }

  /**
   * Create an empty registry
   */
  private createEmptyRegistry(domain: string): ComponentsRegistry {
    return {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      domain,
      components: [],
      statistics: {
        totalComponents: 0,
        totalOccurrences: 0,
        byType: {} as any,
        avgStability: 0,
        mostCommon: [],
      },
    };
  }
}
