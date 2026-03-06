// Developer: Shadow Coderr, Architect
import { test, expect } from '@playwright/test';
import { RuntimeController, RuntimeMode } from '../../src/core/runtime';
import { loadConfig } from '../../src/config/loader';
import * as fs from 'fs-extra';
import * as path from 'path';

test.setTimeout(240000); // 4 minutes for the full flow

test('automated context capture test', async () => {
  const outputDir = path.join(process.cwd(), 'context-graph-output');
  await fs.remove(outputDir); // Clean before test

  const config = await loadConfig();
  config.storage.outputDir = outputDir;
  config.browser.headless = true; // Run headless for CI
  config.browser.channel = 'msedge'; // Use Edge

  const runtime = new RuntimeController(config, RuntimeMode.BROWSER);
  await runtime.initialize();

  const browser = await runtime.launchBrowser();
  const context = await runtime.createContext(browser);
  const page = await context.newPage();
  await runtime.setupPage(page);

  // Now perform the navigation flow
  await page.goto('https://www.saucedemo.com/', { waitUntil: 'networkidle' });
  // Ensure initial page is captured
  await runtime.capturePageIfNeeded(page);
  // Wait a bit for capture to complete
  await page.waitForTimeout(2000);
  await page.locator('[data-test="username"]').click();
  await page.locator('[data-test="username"]').fill('standard_user');
  await page.locator('[data-test="password"]').click();
  await page.locator('[data-test="password"]').fill('secret_sauce');
  await page.locator('[data-test="login-button"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000); // Allow time for page capture
  
  await page.locator('[data-test="item-4-title-link"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000); // Allow time for page capture
  await page.locator('[data-test="add-to-cart"]').click();
  await page.locator('[data-test="back-to-products"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="item-0-title-link"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="add-to-cart"]').click();
  await page.locator('[data-test="back-to-products"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="item-1-title-link"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="back-to-products"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="shopping-cart-link"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="checkout"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.locator('[data-test="firstName"]').click();
  await page.locator('[data-test="firstName"]').fill('asdasd');
  await page.locator('[data-test="lastName"]').click();
  await page.locator('[data-test="lastName"]').fill('hfgfgh');
  await page.locator('[data-test="postalCode"]').click();
  await page.locator('[data-test="postalCode"]').fill('54565');
  await page.locator('[data-test="continue"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="finish"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  await page.locator('[data-test="back-to-products"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Open Menu' }).click({ force: true });
  await page.getByRole('button', { name: 'Open Menu' }).click({ force: true });
  // Attempt to click the About link; if it's not visible, fall back to direct navigation
  try {
    await page.locator('[data-test="about-sidebar-link"]').click({ timeout: 5000 });
  } catch (e) {
    // Fallback: navigate directly to the About target
    await page.goto('https://saucelabs.com/');
  }
  await page.goto('https://www.saucedemo.com/inventory.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  await page.getByRole('button', { name: 'Open Menu' }).click();
  await page.locator('[data-test="logout-sidebar-link"]').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Wait a bit more to ensure all captures complete
  await page.waitForTimeout(3000);

  // Shutdown and wait for captures
  await runtime.shutdown();

  // Now verify the output
  const domainDir = path.join(outputDir, 'saucedemo');
  expect(await fs.pathExists(domainDir)).toBe(true);

  const pagesDir = path.join(domainDir, 'pages');
  expect(await fs.pathExists(pagesDir)).toBe(true);

  const pageFolders = await fs.readdir(pagesDir);
  expect(pageFolders.length).toBeGreaterThan(1); // At least index and inventory

  // Check for logical names - be flexible about exact names
  // Must have at least: index, inventory, and some checkout/cart pages
  expect(pageFolders).toContain('index');
  expect(pageFolders).toContain('inventory');
  
  // Check for inventory item pages (may have different IDs)
  const inventoryItemPages = pageFolders.filter(name => name.startsWith('inventory-item'));
  expect(inventoryItemPages.length).toBeGreaterThan(0);
  
  // Check for cart/checkout pages (names may vary based on URL structure)
  const cartOrCheckoutPages = pageFolders.filter(name => 
    name.includes('cart') || name.includes('checkout')
  );
  expect(cartOrCheckoutPages.length).toBeGreaterThan(0);
  
  console.log('Captured pages:', pageFolders);

  // Check that each page has the required files
  for (const pageName of pageFolders) {
    const pagePath = path.join(pagesDir, pageName);
    const files = await fs.readdir(pagePath);
    expect(files).toContain('DOM');
    expect(files).toContain('a11y_tree.json');
    expect(files).toContain('locators.json');
    expect(files).toContain('metadata.json');
    expect(files).toContain('frames.json');

    const domPath = path.join(pagePath, 'DOM');
    expect(await fs.pathExists(domPath)).toBe(true);

    const domContent = await fs.readFile(domPath, 'utf8');
    expect(domContent.length).toBeGreaterThan(0);
  }
});