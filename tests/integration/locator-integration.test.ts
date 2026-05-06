import { chromium, Browser, Page, expect } from '@playwright/test';
import { LocatorGenerator } from '../../src/analyzers/locator-generator';

describe('locator integration scenarios', () => {
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

  test('repeated controls include scoped locator hints', async () => {
    if (!browserReady || !page) return;
    await page!.setContent(`
      <section aria-label="Primary"><button>Buy</button></section>
      <section aria-label="Secondary"><button>Buy</button></section>
    `);

    const data = await generator.generateLocators(page!);
    const buy = data.elements.filter(e => e.text?.includes('Buy'));
    expect(buy.length).toBeGreaterThanOrEqual(2);
    expect(
      buy.some(el => el.locators.some(l => (l.scope?.length || 0) > 0))
    ).toBe(true);
  });

  test('iframe and shadow controls are reachable in runtime harness', async () => {
    if (!browserReady || !page) return;
    await page!.setContent(`
      <iframe id="frame" srcdoc="<button aria-label='Frame Save'>Frame Save</button>"></iframe>
      <div id="host"></div>
      <script>
        const root = document.querySelector('#host').attachShadow({ mode: 'open' });
        const b = document.createElement('button');
        b.setAttribute('aria-label', 'Shadow Save');
        b.textContent = 'Shadow Save';
        root.appendChild(b);
      </script>
    `);

    const frame = page!.frameLocator('#frame');
    await expect(frame.getByRole('button', { name: 'Frame Save' })).toBeVisible();
    await expect(page!.locator('#host').locator('button')).toHaveCount(1);
  });
});
