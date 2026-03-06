// Developer: Shadow Coderr, Architect
import { Locator } from './capture';

/**
 * Represents a reusable UI component pattern identified across pages
 */
export interface ComponentPattern {
  componentId: string;           // Unique identifier for this component pattern
  name: string;                  // Human-readable component name
  type: ComponentType;           // Type classification of the component
  signature: ComponentSignature; // How to identify this component
  occurrences: ComponentOccurrence[]; // Pages where this component appears
  bestLocators: Locator[];       // Recommended locators for this component
  metadata: ComponentMetadata;   // Additional component metadata
}

/**
 * Types of UI components
 */
export type ComponentType = 
  | 'button' 
  | 'link' 
  | 'form' 
  | 'input' 
  | 'select' 
  | 'navigation' 
  | 'modal' 
  | 'card' 
  | 'list' 
  | 'table' 
  | 'header' 
  | 'footer' 
  | 'sidebar' 
  | 'breadcrumb' 
  | 'pagination' 
  | 'search' 
  | 'login' 
  | 'custom';

/**
 * Signature used to identify a component pattern
 */
export interface ComponentSignature {
  tagName?: string;              // Primary HTML tag
  role?: string;                 // ARIA role
  classes?: string[];            // CSS classes to match
  attributes?: Record<string, string>; // Attribute patterns
  textPattern?: string;          // Regex pattern for text content
  structureHash?: string;        // Hash of DOM structure
}

/**
 * An occurrence of a component on a specific page
 */
export interface ComponentOccurrence {
  pageId: string;               // Capture ID of the page
  pageUrl: string;              // URL of the page
  timestamp: string;            // When this occurrence was captured
  elementId: string;            // Element ID within the page
  locator: Locator;             // Locator used to find this occurrence
  context?: string;             // Surrounding context (parent component)
}

/**
 * Metadata about a component pattern
 */
export interface ComponentMetadata {
  firstSeen: string;            // ISO timestamp when first encountered
  lastSeen: string;             // ISO timestamp when last encountered
  totalOccurrences: number;     // Total number of times seen
  uniquePages: number;          // Number of unique pages containing this component
  avgStability: number;         // Average locator stability score (0-100)
  tags: string[];               // User-defined or auto-generated tags
  description?: string;         // Human-readable description
}

/**
 * The complete components registry
 */
export interface ComponentsRegistry {
  version: string;              // Registry schema version
  createdAt: string;            // When the registry was created
  lastUpdated: string;          // When the registry was last updated
  domain: string;               // Domain this registry applies to
  components: ComponentPattern[]; // All identified component patterns
  statistics: RegistryStatistics; // Aggregate statistics
}

/**
 * Aggregate statistics for the registry
 */
export interface RegistryStatistics {
  totalComponents: number;      // Total number of unique components
  totalOccurrences: number;     // Total occurrences across all pages
  byType: Record<ComponentType, number>; // Count by component type
  avgStability: number;         // Average stability across all components
  mostCommon: string[];         // IDs of most common components
}

/**
 * Options for component extraction
 */
export interface ComponentExtractionOptions {
  minOccurrences: number;       // Minimum occurrences to be considered a pattern
  stabilityThreshold: number;   // Minimum stability score to include
  includeContext: boolean;      // Whether to capture surrounding context
  maxComponents: number;         // Maximum number of components to track
}

/**
 * Result of component extraction from a page
 */
export interface ExtractedComponent {
  elementId: string;            // Element ID from locators
  tagName: string;              // HTML tag name
  role?: string;                 // ARIA role
  text?: string;                // Text content
  locators: Locator[];          // Available locators
  attributes: Record<string, string>; // Element attributes
  signature: ComponentSignature; // Computed signature
}
