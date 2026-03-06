// Developer: Shadow Coderr, Architect
export interface PageState {
  scrollPosition: { x: number; y: number };
  focusedElement?: string;
  selectedText: string;
  formData?: Record<string, any>; // Redacted
  localStorage?: Record<string, string>; // Redacted - keys only
  sessionStorage?: Record<string, string>; // Redacted - keys only
}

export interface NetworkSummary {
  totalRequests: number;
  failedRequests: number;
  requestTypes: {
    xhr?: number;
    fetch?: number;
    document?: number;
    stylesheet?: number;
    script?: number;
    image?: number;
    font?: number;
    other?: number;
  };
  apiEndpoints: string[];
}

export interface PageMetadata {
  captureId: string;
  timestamp: string;
  mode: 'browser' | 'recorder';
  url: string;
  domain: string;
  title: string;
  pageName?: string;
  contentHash?: string;  // Hash of DOM + accessibility + locators for change detection
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  timing: {
    navigationStart: number;
    domContentLoaded: number;
    loadComplete: number;
    networkIdle: number;
    firstContentfulPaint?: number;
    largestContentfulPaint?: number;
    timeToInteractive?: number;
  };
  performance: {
    domNodes: number;
    scripts: number;
    stylesheets: number;
    images: number;
    totalRequests: number;
  };
  userAgent: string;
  cookies: string; // Redacted
  pageState?: PageState;
  networkSummary?: NetworkSummary;
}

export interface AccessibilityTree {
  role: string;
  name: string;
  children?: AccessibilityTree[];
  value?: string;
  required?: boolean;
  disabled?: boolean;
  focused?: boolean;
  multiline?: boolean;
  protected?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  selected?: boolean;
  expanded?: boolean;
  level?: number;
}

export interface Locator {
  strategy: 'role' | 'testid' | 'label' | 'placeholder' | 'text' | 'css';
  value: string;
  confidence: 'high' | 'medium' | 'low';
  resilience: number;
  // Locator candidate metadata for automated locator generation
  matchCount?: number;      // Number of elements matching this selector
  isUnique?: boolean;       // True if matchCount === 1
}

export interface ElementStyles {
  display: string;
  visibility: string;
  opacity: string;
  zIndex: string;
  position: string;
  backgroundColor?: string;
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  border?: string;
  borderRadius?: string;
}

export interface ViewportElement {
  elementId: string;
  visible: boolean;
  inViewport: boolean;
  viewportPosition: { x: number; y: number };
}

export interface FormFieldDetails {
  elementId: string;
  fieldType: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  validationRules?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    required?: boolean;
  };
}

export interface ElementLocator {
  elementId: string;
  tagName: string;
  text?: string;
  locators: Locator[];
  attributes: Record<string, any>;
  computedState: {
    isVisible: boolean;
    isEnabled: boolean;
    isChecked: boolean | null;
    isEditable: boolean;
    isFocusable: boolean;
  };
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  styles?: ElementStyles;
}

export interface LocatorsData {
  elements: ElementLocator[];
  viewportElements?: ViewportElement[];
  formFields?: FormFieldDetails[];
}

export interface NetworkEvent {
  timestamp: string;
  type: 'request' | 'response';
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  headers: Record<string, string>;
  body?: string;
  timing: {
    startTime: number;
    endTime?: number;
    duration?: number;
  };
}

export interface ConsoleMessage {
  timestamp: string;
  type: 'log' | 'debug' | 'info' | 'error' | 'warn' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd' | 'verbose' | 'issue';
  message: string;
  location: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  args: any[];
  stack?: string;
}

export interface ConsoleErrors {
  errors: Array<{
    timestamp: string;
    message: string;
    source: string;
    stack?: string;
  }>;
  warnings: Array<{
    timestamp: string;
    message: string;
    source: string;
  }>;
}

export interface FrameHierarchy {
  url: string;
  name: string;
  children: FrameHierarchy[];
  // Optional serialized content of the frame (including shadow DOM if available)
  content?: string;
}

export interface PageSnapshot {
  metadata: PageMetadata;
  domSnapshot: string;
  a11yTree: AccessibilityTree;
  locators: LocatorsData;
  frames: FrameHierarchy;
  networkEvents: NetworkEvent[];
  consoleMessages: ConsoleMessage[];
  screenshotPaths: string[];
}
