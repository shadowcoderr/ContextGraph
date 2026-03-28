// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';
import * as path from 'path';
import { GlobalManifest, ManifestEntry } from '../types/storage';
import { getVersion } from '../utils/version';

export class ManifestManager {
  private manifestPath: string;

  constructor(outputDir: string) {
    this.manifestPath = path.join(outputDir, 'global_manifest.json');
  }

  async loadManifest(): Promise<GlobalManifest | null> {
    if (await fs.pathExists(this.manifestPath)) {
      return await fs.readJson(this.manifestPath);
    }
    return null;
  }

  async saveManifest(manifest: GlobalManifest): Promise<void> {
    await fs.writeJson(this.manifestPath, manifest, { spaces: 2 });
  }

  async addPageEntry(entry: ManifestEntry): Promise<void> {
    let manifest = await this.loadManifest();
    if (!manifest) {
      manifest = this.createEmptyManifest();
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

    await this.saveManifest(manifest);
  }

  private createEmptyManifest(): GlobalManifest {
    return {
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
        storageSize: '0 KB'
      }
    };
  }
}
