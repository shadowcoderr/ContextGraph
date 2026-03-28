// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';
import * as path from 'path';
import { NetworkEvent } from '../types/capture';
import { logger } from '../utils/logger';
import { getVersion } from '../utils/version';

export interface ApiEndpoint {
  method: string;
  /** Normalised path with path-parameter placeholders, e.g. /users/{id}/orders */
  path: string;
  /** Raw paths observed before normalisation */
  rawPaths: string[];
  observedCount: number;
  statusCodes: number[];
  avgDurationMs: number | null;
  hasRequestBody: boolean;
  hasResponseBody: boolean;
  contentTypes: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface ApiInventory {
  version: string;
  generatedAt: string;
  baseUrl: string | null;
  capturedDuration: string;
  totalRequests: number;
  totalFailedRequests: number;
  uniqueEndpoints: number;
  endpoints: ApiEndpoint[];
  resourceBreakdown: Record<string, number>;
  statusCodeBreakdown: Record<string, number>;
}

/**
 * Patterns that identify path segments as dynamic parameters.
 * Matched in order — first match wins.
 */
const PARAM_PATTERNS: Array<{ regex: RegExp; placeholder: string }> = [
  {
    regex: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    placeholder: '{uuid}',
  },
  { regex: /^\d{10,}$/, placeholder: '{timestamp}' },
  { regex: /^\d+$/, placeholder: '{id}' },
  { regex: /^[0-9a-f]{24}$/, placeholder: '{objectid}' }, // MongoDB ObjectId
  { regex: /^[0-9a-zA-Z_-]{20,}$/, placeholder: '{token}' },
];

/**
 * NetworkPatternAnalyzer
 *
 * Post-processes captured network events to produce a structured API inventory.
 * Duplicate URLs are deduplicated, path parameters (numeric IDs, UUIDs, etc.)
 * are normalised into `{param}` placeholders, and status codes / durations
 * are aggregated per endpoint.
 *
 * Usage:
 *
 *   const analyzer = new NetworkPatternAnalyzer(outputDir);
 *   const inventory = await analyzer.analyze();
 *   // → context-graph-output/<domain>/api_inventory.json
 *
 * Or pass raw NetworkEvents directly:
 *
 *   const inventory = analyzer.analyzeEvents(events, 'https://api.example.com');
 */
export class NetworkPatternAnalyzer {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = path.resolve(outputDir);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Read all captured network traffic from the output directory, analyse it,
   * and write an `api_inventory.json` file to the domain directory.
   * Returns the path to the generated file.
   */
  async analyze(): Promise<string> {
    const domain = this.detectDomain();
    if (!domain) throw new Error('No captured domain found');

    const trafficLog = path.join(this.outputDir, domain, 'network', 'traffic_log.jsonl');
    const events = await this.loadEventsFromJSONL(trafficLog);

    if (events.length === 0) {
      logger.warn('NetworkPatternAnalyzer: no network events found, generating empty inventory');
    }

    // Determine base URL from the most common hostname
    const baseUrl = this.detectBaseUrl(events);

    const inventory = this.analyzeEvents(events, baseUrl);

    const outputPath = path.join(this.outputDir, domain, 'api_inventory.json');
    await fs.writeJson(outputPath, inventory, { spaces: 2 });
    logger.info(`NetworkPatternAnalyzer: API inventory saved to ${outputPath}`);

    return outputPath;
  }

  /**
   * Analyse an in-memory array of NetworkEvents and return an ApiInventory.
   * Does NOT write to disk — useful for programmatic / test use.
   */
  analyzeEvents(events: NetworkEvent[], baseUrl: string | null = null): ApiInventory {
    const apiEvents = events.filter(
      e => e.type === 'request' && (e.resourceType === 'xhr' || e.resourceType === 'fetch')
    );
    console.log(`Found ${apiEvents.length} API events`);

    // Build response lookup keyed by method + url
    const responseMap = new Map<string, NetworkEvent>();
    for (const e of events) {
      if (e.type === 'response') {
        responseMap.set(`${e.method}|${e.url}`, e);
      }
    }

    // Aggregate by normalised endpoint
    const endpointMap = new Map<string, ApiEndpoint>();
    const resourceCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};

    const firstTimestamp = events[0]?.timestamp ?? new Date().toISOString();
    const lastTimestamp = events[events.length - 1]?.timestamp ?? firstTimestamp;

    for (const event of events) {
      // Resource type breakdown (all events)
      resourceCounts[event.resourceType] = (resourceCounts[event.resourceType] || 0) + 1;

      if (event.type !== 'request') continue;

      // Parse and normalise the URL path
      let parsedPath: string;
      let host: string;
      try {
        const u = new URL(event.url);
        parsedPath = u.pathname;
        host = u.hostname;
      } catch {
        continue; // unparseable
      }

      const normalised = this.normalisePath(parsedPath);
      const key = `${event.method}||${host}||${normalised}`;

      const response = responseMap.get(`${event.method}|${event.url}`);
      const status = response?.status;
      const duration = response?.timing?.duration ?? null;

      if (status !== undefined) {
        const statusKey = `${Math.floor(status / 100)}xx`;
        statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
      }

      let ep = endpointMap.get(key);
      if (!ep) {
        ep = {
          method: event.method,
          path: normalised,
          rawPaths: [],
          observedCount: 0,
          statusCodes: [],
          avgDurationMs: null,
          hasRequestBody: false,
          hasResponseBody: false,
          contentTypes: [],
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
        };
        endpointMap.set(key, ep);
      }

      ep.observedCount++;
      if (!ep.rawPaths.includes(parsedPath)) ep.rawPaths.push(parsedPath);

      if (status !== undefined && !ep.statusCodes.includes(status)) {
        ep.statusCodes.push(status);
      }

      if (duration !== null) {
        if (ep.avgDurationMs === null) {
          ep.avgDurationMs = duration;
        } else {
          ep.avgDurationMs = Math.round((ep.avgDurationMs + duration) / 2);
        }
      }

      const ct = event.headers?.['content-type'] || response?.headers?.['content-type'] || '';
      if (ct && !ep.contentTypes.includes(ct.split(';')[0].trim())) {
        ep.contentTypes.push(ct.split(';')[0].trim());
      }

      ep.hasRequestBody =
        ep.hasRequestBody || ['POST', 'PUT', 'PATCH'].includes(event.method);
      ep.hasResponseBody = ep.hasResponseBody || Boolean(response && status && status < 400);

      if (event.timestamp < ep.firstSeen) ep.firstSeen = event.timestamp;
      if (event.timestamp > ep.lastSeen) ep.lastSeen = event.timestamp;
    }

    const endpoints = Array.from(endpointMap.values()).sort((a, b) => {
      // Sort by HTTP method priority, then alphabetically by path
      const methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      const ai = methodOrder.indexOf(a.method);
      const bi = methodOrder.indexOf(b.method);
      if (ai !== bi) return ai - bi;
      return a.path.localeCompare(b.path);
    });

    const failedRequests = events.filter(e => (e as any).type === 'failed').length;

    return {
      version: getVersion(),
      generatedAt: new Date().toISOString(),
      baseUrl,
      capturedDuration: this.computeDuration(firstTimestamp, lastTimestamp),
      totalRequests: events.filter(e => e.type === 'request').length,
      totalFailedRequests: failedRequests,
      uniqueEndpoints: endpoints.length,
      endpoints,
      resourceBreakdown: resourceCounts,
      statusCodeBreakdown: statusCounts,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Normalise a URL path by replacing dynamic segments with typed placeholders.
   *
   * /users/12345/orders/abc123  →  /users/{id}/orders/{token}
   * /api/v2/items/6452          →  /api/v2/items/{id}
   */
  normalisePath(urlPath: string): string {
    if (!urlPath) return '/';

    const segments = urlPath.split('/').filter(Boolean);
    const normalised = segments.map(segment => {
      // Decode percent-encoded characters before testing
      let decoded = segment;
      try { decoded = decodeURIComponent(segment); } catch { /* leave as-is */ }

      for (const { regex, placeholder } of PARAM_PATTERNS) {
        if (regex.test(decoded)) return placeholder;
      }
      return segment;
    });

    return '/' + normalised.join('/');
  }

  private async loadEventsFromJSONL(filePath: string): Promise<NetworkEvent[]> {
    if (!(await fs.pathExists(filePath))) {
      logger.warn(`NetworkPatternAnalyzer: traffic log not found at ${filePath}`);
      return [];
    }

    const raw = await fs.readFile(filePath, 'utf8');
    const events: NetworkEvent[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        logger.debug(`NetworkPatternAnalyzer: skipping malformed line: ${trimmed.substring(0, 80)}`);
      }
    }

    return events;
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

  private detectBaseUrl(events: NetworkEvent[]): string | null {
    const hostCounts = new Map<string, number>();

    for (const e of events) {
      if (e.type !== 'request') continue;
      try {
        const u = new URL(e.url);
        const key = `${u.protocol}//${u.host}`;
        hostCounts.set(key, (hostCounts.get(key) || 0) + 1);
      } catch { /* skip */ }
    }

    if (hostCounts.size === 0) return null;

    let topHost = '';
    let topCount = 0;
    for (const [host, count] of hostCounts.entries()) {
      if (count > topCount) { topHost = host; topCount = count; }
    }

    return topHost || null;
  }

  private computeDuration(start: string, end: string): string {
    try {
      const ms = new Date(end).getTime() - new Date(start).getTime();
      if (ms < 0) return 'unknown';
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);

      return parts.join(' ');
    } catch {
      return 'unknown';
    }
  }
}
