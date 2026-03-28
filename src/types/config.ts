// Developer: Shadow Coderr, Architect
export interface BrowserConfig {
  channel: 'msedge' | 'chromium' | 'firefox';
  headless: boolean;
  viewport: {
    width: number;
    height: number;
  };
  slowMo: number;
}

export interface LocatorConfig {
  enabled: boolean;                    // Enable/disable locator generation
  maxElements: number;                 // Maximum number of elements to analyze per page
  maxCandidatesPerElement: number;     // Maximum locator candidates per element
  includeUniquenessChecks: boolean;    // Calculate match counts and uniqueness
}

export interface ComponentsConfig {
  enabled: boolean;                    // Enable/disable components registry
  minOccurrences: number;              // Minimum occurrences to be considered a pattern
  maxComponents: number;              // Maximum components to track
}

export interface NotificationsConfig {
  enabled: boolean;                    // Show in-page overlay during capture operations
}

export interface CaptureConfig {
  screenshots: {
    enabled: boolean;
    fullPage: boolean;
    elementTargeting: boolean;
  };
  network: {
    enabled: boolean;
    captureHeaders: boolean;
    captureBody: boolean;
  };
  accessibility: {
    enabled: boolean;
    includeHidden: boolean;
  };
  locators: LocatorConfig;
  components: ComponentsConfig;
  notifications: NotificationsConfig;
  forceCapture: boolean;              // Always capture even if content hash unchanged
}

export interface SecurityConfig {
  redactPatterns: string[];
  redactHeaders: string[];
  customPatterns: RedactionRule[];
}

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface StorageConfig {
  outputDir: string;
  compression: boolean;
  prettyJson: boolean;
}

export interface Config {
  browser: BrowserConfig;
  capture: CaptureConfig;
  security: SecurityConfig;
  storage: StorageConfig;
}
