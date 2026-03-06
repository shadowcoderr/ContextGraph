const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration
const ROOT_DIR = __dirname;

// Find the domain directory (should be the only directory in the root)
const getDomainDirectory = () => {
  const items = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  const domainDirs = items
    .filter(item => item.isDirectory() && item.name !== 'node_modules')
    .map(dir => dir.name);

  if (domainDirs.length === 0) {
    throw new Error('No domain directory found. Please ensure you have captured some pages first.');
  }
  
  return domainDirs[0]; // Use the first directory found (should be the only one)
};

const DOMAIN = getDomainDirectory();
const DOMAIN_DIR = path.join(ROOT_DIR, DOMAIN);
const PAGES_DIR = path.join(DOMAIN_DIR, 'pages');
const GLOBAL_MANIFEST_PATH = path.join(ROOT_DIR, 'global_manifest.json');
const NEW_MANIFEST_PATH = path.join(DOMAIN_DIR, 'global_manifest.json');
const PAGE_FLOW_PATH = path.join(DOMAIN_DIR, 'page_flow.json');

// Read the current global manifest
let globalManifest = {
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
    storageSize: '0 MB'
  }
};

// Try to read existing manifest if it exists
if (fs.existsSync(GLOBAL_MANIFEST_PATH)) {
  try {
    globalManifest = JSON.parse(fs.readFileSync(GLOBAL_MANIFEST_PATH, 'utf-8'));
    globalManifest.lastUpdated = new Date().toISOString();
  } catch (error) {
    console.warn('Error reading global_manifest.json, creating a new one');
  }
}

// Ensure the domain directory exists
if (!fs.existsSync(DOMAIN_DIR)) {
  fs.mkdirSync(DOMAIN_DIR, { recursive: true });
}

// Move the global manifest to the domain directory
fs.writeFileSync(NEW_MANIFEST_PATH, JSON.stringify(globalManifest, null, 2));
console.log(`Moved global_manifest.json to ${DOMAIN_DIR}`);

// Remove the old manifest if it's different from the new location
if (GLOBAL_MANIFEST_PATH !== NEW_MANIFEST_PATH && fs.existsSync(GLOBAL_MANIFEST_PATH)) {
  fs.unlinkSync(GLOBAL_MANIFEST_PATH);
}

// Generate page flow data
function generatePageFlow() {
  const pageDirs = fs.readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  const pages = [];
  const pageFlows = [];
  
  // Process each page
  pageDirs.forEach(pageDir => {
    const metadataPath = path.join(PAGES_DIR, pageDir, 'metadata.json');
    const locatorsPath = path.join(PAGES_DIR, pageDir, 'locators.json');
    
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        const pageId = pageDir.replace(/[^a-z0-9_]/gi, '-').toLowerCase();
        
        // Get interactive elements from locators
        let interactiveElements = [];
        if (fs.existsSync(locatorsPath)) {
          try {
            const locatorsData = JSON.parse(fs.readFileSync(locatorsPath, 'utf-8'));
            interactiveElements = locatorsData.elements || [];
          } catch (error) {
            console.warn(`Error reading locators for ${pageDir}:`, error.message);
          }
        }
        
        // Create page entry
        const page = {
          id: pageId,
          name: metadata.title || pageDir,
          url: metadata.url || '',
          path: pageDir,
          timestamp: metadata.timestamp || new Date().toISOString(),
          interactiveElements: interactiveElements.length,
          screenshot: `pages/${pageDir}/screenshot.png`
        };
        
        pages.push(page);
        
      } catch (error) {
        console.warn(`Error processing ${pageDir}:`, error.message);
      }
    }
  });
  
  // Generate page flows based on navigation patterns
  if (pages.length > 0) {
    // Simple flow: home -> item -> home
    const homePage = pages.find(p => p.id.includes('index') || p.id.includes('home'));
    const itemPages = pages.filter(p => p.id.includes('inventory-item'));
    
    if (homePage && itemPages.length > 0) {
      const flowId = `flow_${Date.now()}`;
      const flow = {
        id: flowId,
        name: 'Browse Inventory',
        description: 'User browses from home to item details and back',
        steps: [
          { pageId: homePage.id, action: 'navigate', timestamp: new Date().toISOString() }
        ]
      };
      
      // Add item pages to the flow
      itemPages.forEach((itemPage, index) => {
        flow.steps.push({
          pageId: itemPage.id,
          action: 'click',
          element: 'inventory-item',
          timestamp: new Date(Date.now() + (index + 1) * 1000).toISOString()
        });
        
        flow.steps.push({
          pageId: homePage.id,
          action: 'navigate',
          timestamp: new Date(Date.now() + (index + 2) * 1000).toISOString()
        });
      });
      
      pageFlows.push(flow);
    }
  }
  
  return {
    version: '0.3.0',
    generatedAt: new Date().toISOString(),
    domain: DOMAIN,
    pages,
    pageFlows,
    statistics: {
      totalPages: pages.length,
      totalFlows: pageFlows.length,
      totalInteractiveElements: pages.reduce((sum, page) => sum + (page.interactiveElements || 0), 0)
    }
  };
}

// Generate and save the page flow
const pageFlowData = generatePageFlow();
fs.writeFileSync(PAGE_FLOW_PATH, JSON.stringify(pageFlowData, null, 2));
console.log(`Generated page flow at ${PAGE_FLOW_PATH}`);

console.log('Reorganization complete!');
