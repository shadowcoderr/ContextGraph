// Developer: Shadow Coderr, Architect
export interface ManifestEntry {
  captureId: string;
  url: string;
  title: string;
  timestamp: string;
  sessionId: string;
  domain: string;
  mode: 'browser' | 'recorder';
}

export interface SessionSummary {
  sessionId: string;
  mode: 'browser' | 'recorder';
  startTime: string;
  endTime: string;
  domains: string[];
  totalPages: number;
  totalActions?: number;
}

export interface DomainSummary {
  domain: string;
  firstVisited: string;
  lastVisited: string;
  totalVisits: number;
  pages: ManifestEntry[];
}

export interface GlobalManifest {
  version: string;
  createdAt: string;
  lastUpdated: string;
  sessions: SessionSummary[];
  domains: DomainSummary[];
  componentsRegistry?: {
    path: string;              // Relative path to components_registry.json
    totalComponents: number;   // Cached count of components
    lastUpdated: string;       // When registry was last updated
  };
  statistics: {
    totalSessions: number;
    totalDomains: number;
    totalPages: number;
    totalNetworkRequests: number;
    totalScreenshots: number;
    storageSize: string;
    totalComponents?: number;   // Total components tracked
  };
}

export interface RedactionAuditEntry {
  timestamp: string;
  context: string;
  url?: string;
  redactions: Array<{
    rule: string;
    count: number;
    field: string;
  }>;
}
