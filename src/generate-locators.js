const fs = require('fs');
const path = require('path');

// Find the domain directory (should be the only directory in the root)
const getDomainDirectory = () => {
  const items = fs.readdirSync(__dirname, { withFileTypes: true });
  const domainDirs = items
    .filter(item => item.isDirectory() && item.name !== 'node_modules')
    .map(dir => dir.name);

  if (domainDirs.length === 0) {
    throw new Error('No domain directory found. Please ensure you have captured some pages first.');
  }
  
  return domainDirs[0];
};

// Configuration
const DOMAIN = getDomainDirectory();
const OUTPUT_DIR = path.join(__dirname, DOMAIN);
const PAGES_DIR = path.join(OUTPUT_DIR, 'pages');

// Function to generate robust locators for an element
function generateLocators(element) {
  const locators = [];
  
  // 1. Role-based locator (most reliable)
  if (element.role) {
    locators.push({
      type: 'role',
      value: element.role,
      priority: 1,
      description: 'Role-based selector',
      selector: `getByRole('${element.role}', { name: '${element.accessibleName || ''}' })`
    });
  }

  // 2. Test ID (if available)
  if (element.attributes && element.attributes['data-testid']) {
    locators.push({
      type: 'testid',
      value: element.attributes['data-testid'],
      priority: 1,
      description: 'Test ID selector',
      selector: `getByTestId('${element.attributes['data-testid']}')`
    });
  }

  // 3. Text content (for buttons, links, etc.)
  if (element.text && element.text.trim().length > 0) {
    locators.push({
      type: 'text',
      value: element.text.trim(),
      priority: 2,
      description: 'Text-based selector',
      selector: `getByText('${element.text.trim().replace(/'/g, "\\'")}')`
    });
  }

  // 4. ARIA label
  if (element.attributes && element.attributes['aria-label']) {
    locators.push({
      type: 'aria-label',
      value: element.attributes['aria-label'],
      priority: 2,
      description: 'ARIA label selector',
      selector: `getByLabel('${element.attributes['aria-label']}')`
    });
  }

  // 5. CSS Selector (fallback)
  if (element.attributes && element.attributes.id) {
    locators.push({
      type: 'css',
      value: `#${element.attributes.id}`,
      priority: 3,
      description: 'CSS ID selector',
      selector: `locator('#${element.attributes.id}')`
    });
  } else if (element.tagName) {
    // Simple class-based selector as last resort
    const classAttr = element.attributes && element.attributes.class ? `.${element.attributes.class.split(' ')[0]}` : '';
    const selector = `${element.tagName}${classAttr}`;
    
    locators.push({
      type: 'css',
      value: selector,
      priority: 4,
      description: 'CSS selector',
      selector: `locator('${selector}')`
    });
  }

  return locators;
}

// Process a single page directory
async function processPage(pageDir) {
  try {
    const domPath = path.join(pageDir, 'DOM');
    const a11yPath = path.join(pageDir, 'a11y_tree.json');
    const locatorsPath = path.join(pageDir, 'locators.json');
    
    // Skip if we don't have the required files
    if (!fs.existsSync(a11yPath)) {
      console.log(`Skipping ${pageDir}: a11y_tree.json not found`);
      return;
    }

    // Read the accessibility tree
    const a11yTree = JSON.parse(fs.readFileSync(a11yPath, 'utf-8'));
    
    // Generate locators for interactive elements
    const interactiveElements = [];
    
    function processNode(node) {
      // Only process interactive elements
      if (node.role && [
        'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
        'menuitem', 'tab', 'slider', 'switch'
      ].includes(node.role.toLowerCase())) {
        const element = {
          id: node.id || `elem_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          tagName: node.tagName || '',
          role: node.role || '',
          name: node.name || '',
          text: node.text || '',
          attributes: node.attributes || {},
          locators: generateLocators(node)
        };
        
        // Add to interactive elements
        interactiveElements.push(element);
      }
      
      // Process children recursively
      if (node.children) {
        node.children.forEach(processNode);
      }
    }
    
    // Process the accessibility tree
    processNode(a11yTree);
    
    // Write the locators file
    const locatorsData = {
      version: '0.3.0',
      generatedAt: new Date().toISOString(),
      elements: interactiveElements
    };
    
    fs.writeFileSync(locatorsPath, JSON.stringify(locatorsData, null, 2));
    console.log(`Generated ${interactiveElements.length} locators for ${path.basename(pageDir)}`);
    
  } catch (error) {
    console.error(`Error processing ${pageDir}:`, error.message);
  }
}

// Main function
async function main() {
  try {
    // Get all page directories
    const pageDirs = fs.readdirSync(PAGES_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => path.join(PAGES_DIR, dirent.name));
    
    console.log(`Found ${pageDirs.length} page directories to process`);
    
    // Process each page directory
    for (const pageDir of pageDirs) {
      await processPage(pageDir);
    }
    
    console.log('Locator generation complete!');
    
  } catch (error) {
    console.error('Error in main process:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
