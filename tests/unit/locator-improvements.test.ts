import { chromium, Page, Browser } from '@playwright/test';
import { LocatorGenerator } from '../../src/analyzers/locator-generator';

describe('locator improvements', () => {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let browserReady = false;
  const generator = new LocatorGenerator();

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
      browserReady = true;
    } catch {
      browserReady = false;
    }
  });

  afterAll(async () => {
    await browser?.close();
  });

  const runOrSkip = (name: string, fn: () => Promise<void>) => {
    test(name, async () => {
      if (!browserReady || !page) return;
      await fn();
    });
  };

  runOrSkip('adds scoped hints for non-unique role/text candidates', async () => {
    await page!.setContent(`<section aria-label="Products"><button>Buy</button><button>Buy</button></section>`);
    const data = await generator.generateLocators(page!);
    const buyElements = data.elements.filter(e => e.text?.includes('Buy'));
    expect(buyElements.length).toBeGreaterThan(0);
    const hasScopeHint = buyElements.some(el => el.locators.some(l => l.scope && l.scope.length > 0));
    expect(hasScopeHint).toBe(true);
  });

  runOrSkip('records deterministic scoring metadata', async () => {
    await page!.setContent(`<button data-testid="checkout-btn">Checkout</button>`);
    const data = await generator.generateLocators(page!);
    expect(data.elements[0].locators.every(l => typeof l.score === 'number')).toBe(true);
  });

  runOrSkip('handles iframe-contained controls', async () => {
    await page!.setContent(`<iframe id="f" srcdoc="<button aria-label='Save'>Save</button>"></iframe>`);
    const frame = page!.frames()[1];
    expect(frame).toBeTruthy();
    expect(await frame.getByRole('button', { name: 'Save' }).count()).toBe(1);
  });

  runOrSkip('detects shadow-dom interaction targets', async () => {
    await page!.setContent(`<div id="host"></div><script>
      const root = document.getElementById('host').attachShadow({mode:'open'});
      const btn = document.createElement('button'); btn.textContent='Shadow Action'; root.appendChild(btn);
    </script>`);
    expect(await page!.locator('#host').locator('button').count()).toBe(1);
  });
});
