// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import { ElementLocator, Locator, LocatorsData } from '../types/capture';
import { logger } from '../utils/logger';

/**
 * Raw element data extracted from the DOM via a single page.evaluate() call.
 * All properties are plain serialisable values so they survive the structured-
 * clone boundary between the browser context and Node.js.
 */
interface RawElement {
  tagName: string;
  inputType: string;
  id: string;
  name: string;
  textContent: string;
  accessibleName: string;
  role: string;
  placeholder: string;
  dataTestId: string;
  cssSelector: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isEnabled: boolean;
  isChecked: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * LocatorGenerator
 *
 * Previous implementation used per-element page.evaluate() calls.
 * On complex pages (e.g. Amazon, SPAs with strict CSP) those individual
 * calls fail silently — element.evaluate() catches the error and returns ''
 * which the `!elementKey` guard interprets as "already seen", skipping every
 * element and producing an empty locators.json.
 *
 * This rewrite uses a SINGLE page.evaluate() to snapshot all interactive
 * element data in one round-trip, then builds Playwright locator strategy
 * strings entirely in Node.js from the extracted data.  Uniqueness is
 * verified in a second, batched evaluate() rather than N individual
 * locator.count() calls.
 */
export class LocatorGenerator {
  async generateLocators(page: Page): Promise<LocatorsData> {
    logger.info('LocatorGenerator: starting locator generation');

    // Give the page a moment to settle after navigation
    try {
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
    } catch {
      logger.debug('LocatorGenerator: network-idle timeout, continuing');
    }

    // ── Step 1: Single DOM scan ─────────────────────────────────────────────
    let rawElements: RawElement[] = [];
    try {
      rawElements = await page.evaluate(domScanScript);
      logger.debug(`LocatorGenerator: primary scan found ${rawElements.length} elements`);
    } catch (primaryError) {
      logger.warn(`LocatorGenerator: primary scan failed (${(primaryError as Error).message}), trying fallback`);
      try {
        rawElements = await page.evaluate(fallbackScanScript);
        logger.debug(`LocatorGenerator: fallback scan found ${rawElements.length} elements`);
      } catch (fallbackError) {
        logger.error(`LocatorGenerator: both scan strategies failed — ${(fallbackError as Error).message}`);
        return { elements: [] };
      }
    }

    if (rawElements.length === 0) {
      logger.info('LocatorGenerator: no interactive elements found on page');
      return { elements: [] };
    }

    // ── Step 2: Build ElementLocator objects from raw data (no async) ───────
    const elementLocators: ElementLocator[] = rawElements
      .map((raw, index) => buildElementLocator(raw, index))
      .filter((el): el is ElementLocator => el !== null);

    // ── Step 3: Batch uniqueness verification ───────────────────────────────
    await batchVerifyUniqueness(page, elementLocators);

    logger.info(`LocatorGenerator: generated locators for ${elementLocators.length} elements`);
    return { elements: elementLocators };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser-side functions (must be entirely self-contained — no outer scope refs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Primary DOM scan.
 * Queries all standard interactive elements plus ARIA-role overrides.
 * Deduplicates by (tagName, x, y) position to avoid reporting the same
 * element twice when multiple CSS selectors match it.
 * Capped at 500 elements to bound memory and serialisation cost.
 */
function domScanScript(): RawElement[] {
  const SELECTOR = [
    'button:not([disabled])',
    'a[href]:not([href=""]):not([href^="javascript"])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]:not([disabled])',
    '[role="link"]',
    '[role="textbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="option"]',
  ].join(',');

  function inferRole(el: Element): string {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = ((el as HTMLInputElement).type || '').toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    return tag;
  }

  function getAccessibleName(el: Element): string {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel?.trim()) return ariaLabel.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map((id: string) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    const eid = (el as HTMLElement).id;
    if (eid) {
      const lbl = document.querySelector(`label[for="${eid}"]`);
      if (lbl) return lbl.textContent?.trim() || '';
    }

    const parentLbl = el.closest('label');
    if (parentLbl && parentLbl !== el) {
      const clone = parentLbl.cloneNode(true) as HTMLElement;
      const inputInClone = clone.querySelector(el.tagName);
      if (inputInClone) inputInClone.remove();
      const t = clone.textContent?.trim() || '';
      if (t) return t;
    }

    const alt = el.getAttribute('alt');
    if (alt?.trim()) return alt.trim();

    const title = el.getAttribute('title');
    if (title?.trim()) return title.trim();

    return (el.textContent || '').trim().substring(0, 100);
  }

  function buildCSS(el: Element): string {
    const eid = (el as HTMLElement).id;
    if (eid) {
      try { return `#${CSS.escape(eid)}`; } catch { return `#${eid}`; }
    }
    const testId =
      el.getAttribute('data-testid') ||
      el.getAttribute('data-test') ||
      el.getAttribute('data-cy') ||
      el.getAttribute('data-qa');
    if (testId) return `[data-testid="${testId}"]`;

    const tag = el.tagName.toLowerCase();
    const name = (el as HTMLInputElement).name;
    if (name) return `${tag}[name="${name}"]`;

    const cls = (el as HTMLElement).className;
    if (cls && typeof cls === 'string') {
      const safe = cls.split(/\s+/).find((c: string) => c && /^[a-zA-Z][\w-]*$/.test(c));
      if (safe) return `${tag}.${safe}`;
    }

    // aria-label as last resort CSS attribute
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;

    return tag;
  }

  function getAttrs(el: Element): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      out[a.name] = a.value;
    }
    return out;
  }

  const seen = new Set<string>();
  const results: RawElement[] = [];

  let candidates: Element[];
  try {
    candidates = Array.from(document.querySelectorAll(SELECTOR));
  } catch {
    return [];
  }

  for (const el of candidates) {
    if (results.length >= 500) break;
    try {
      const rect = el.getBoundingClientRect();
      const dedupKey = `${el.tagName}|${Math.round(rect.x)}|${Math.round(rect.y)}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const style = window.getComputedStyle(el);
      const isVisible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        parseFloat(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0;

      const tag = el.tagName.toLowerCase();
      const inputType = ((el as HTMLInputElement).type || '').toLowerCase();

      results.push({
        tagName: tag,
        inputType,
        id: (el as HTMLElement).id || '',
        name: (el as HTMLInputElement).name || '',
        textContent: (el.textContent || '').trim().substring(0, 150),
        accessibleName: getAccessibleName(el),
        role: inferRole(el),
        placeholder: (el as HTMLInputElement).placeholder || '',
        dataTestId: (
          el.getAttribute('data-testid') ||
          el.getAttribute('data-test') ||
          el.getAttribute('data-cy') ||
          el.getAttribute('data-qa') ||
          ''
        ),
        cssSelector: buildCSS(el),
        attributes: getAttrs(el),
        isVisible,
        isEnabled: !(el as HTMLInputElement).disabled,
        isChecked:
          (inputType === 'checkbox' || inputType === 'radio')
            ? (el as HTMLInputElement).checked
            : false,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    } catch {
      // Skip individual element errors — never abort the whole scan
    }
  }

  return results;
}

/**
 * Fallback DOM scan — simpler selectors and minimal processing.
 * Used when the primary scan throws (e.g. strict CSP or execution context issues).
 */
function fallbackScanScript(): RawElement[] {
  const tags = ['button', 'a', 'input', 'select', 'textarea'];
  const results: RawElement[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    let els: Element[];
    try { els = Array.from(document.querySelectorAll(tag)); } catch { continue; }

    for (const el of els) {
      if (results.length >= 300) break;
      try {
        const rect = el.getBoundingClientRect();
        const key = `${tag}|${Math.round(rect.x)}|${Math.round(rect.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const style = window.getComputedStyle(el);
        const isVis =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 && rect.height > 0;

        const inputType = ((el as HTMLInputElement).type || '').toLowerCase();
        const eid = (el as HTMLElement).id || '';
        const testId = el.getAttribute('data-testid') || '';
        const role = el.getAttribute('role') || (() => {
          if (tag === 'button') return 'button';
          if (tag === 'a') return 'link';
          if (tag === 'input') {
            if (inputType === 'checkbox') return 'checkbox';
            if (inputType === 'radio') return 'radio';
            return 'textbox';
          }
          if (tag === 'select') return 'combobox';
          if (tag === 'textarea') return 'textbox';
          return tag;
        })();

        const css = eid ? `#${eid}` : testId ? `[data-testid="${testId}"]` : tag;
        const name = (el as HTMLInputElement).name || '';
        const ariaLabel = el.getAttribute('aria-label') || '';

        const attrs: Record<string, string> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          attrs[el.attributes[i].name] = el.attributes[i].value;
        }

        results.push({
          tagName: tag,
          inputType,
          id: eid,
          name,
          textContent: (el.textContent || '').trim().substring(0, 150),
          accessibleName: ariaLabel || (el.textContent || '').trim().substring(0, 100),
          role,
          placeholder: (el as HTMLInputElement).placeholder || '',
          dataTestId: testId,
          cssSelector: css,
          attributes: attrs,
          isVisible: isVis,
          isEnabled: !(el as HTMLInputElement).disabled,
          isChecked: (inputType === 'checkbox' || inputType === 'radio') ? (el as HTMLInputElement).checked : false,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      } catch { /* skip */ }
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node.js helpers (run in the LocatorGenerator class scope)
// ─────────────────────────────────────────────────────────────────────────────

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildElementLocator(raw: RawElement, index: number): ElementLocator | null {
  try {
    const locators = buildLocatorStrategies(raw);
    const result: ElementLocator = {
      elementId: `elem_${String(index).padStart(3, '0')}`,
      tagName: raw.tagName,
      locators,
      attributes: raw.attributes,
      computedState: {
        isVisible: raw.isVisible,
        isEnabled: raw.isEnabled,
        isChecked: raw.isChecked,
        isEditable:
          ['input', 'textarea', 'select'].includes(raw.tagName) && raw.isEnabled,
        isFocusable: raw.isVisible && raw.isEnabled,
      },
      position: {
        x: raw.rect.x,
        y: raw.rect.y,
        width: raw.rect.width,
        height: raw.rect.height,
      },
    };
    if (raw.textContent) result.text = raw.textContent;
    return result;
  } catch (error) {
    logger.debug(`LocatorGenerator: failed to build locator for element ${index}: ${(error as Error).message}`);
    return null;
  }
}

function buildLocatorStrategies(raw: RawElement): Locator[] {
  const locators: Locator[] = [];
  const accessible = (raw.accessibleName || raw.textContent || '').trim();

  // 1. Test ID — highest resilience, most stable
  if (raw.dataTestId) {
    locators.push({
      strategy: 'testid',
      value: `getByTestId('${escapeStr(raw.dataTestId)}')`,
      confidence: 'high',
      resilience: 90,
      matchCount: 0,
      isUnique: false,
    });
  }

  // 2. Role with accessible name
  if (raw.role) {
    const nameForRole = accessible.substring(0, 80);
    if (nameForRole) {
      locators.push({
        strategy: 'role',
        value: `getByRole('${raw.role}', { name: '${escapeStr(nameForRole)}' })`,
        confidence: 'high',
        resilience: 85,
        matchCount: 0,
        isUnique: false,
      });
    } else {
      locators.push({
        strategy: 'role',
        value: `getByRole('${raw.role}')`,
        confidence: 'medium',
        resilience: 65,
        matchCount: 0,
        isUnique: false,
      });
    }
  }

  // 3. Label (form elements only)
  if (['input', 'select', 'textarea'].includes(raw.tagName)) {
    const labelText = (raw.accessibleName || raw.attributes['aria-label'] || '').trim();
    if (labelText) {
      locators.push({
        strategy: 'label',
        value: `getByLabel('${escapeStr(labelText)}')`,
        confidence: 'high',
        resilience: 80,
        matchCount: 0,
        isUnique: false,
      });
    }
  }

  // 4. Placeholder
  if (raw.placeholder) {
    locators.push({
      strategy: 'placeholder',
      value: `getByPlaceholder('${escapeStr(raw.placeholder)}')`,
      confidence: 'medium',
      resilience: 65,
      matchCount: 0,
      isUnique: false,
    });
  }

  // 5. Text (buttons, links — only when text is short and meaningful)
  const textForLocator = accessible.trim();
  if (
    textForLocator.length > 0 &&
    textForLocator.length <= 60 &&
    (['button', 'link', 'menuitem', 'tab'].includes(raw.role) ||
      ['a', 'button'].includes(raw.tagName))
  ) {
    locators.push({
      strategy: 'text',
      value: `getByText('${escapeStr(textForLocator)}')`,
      confidence: 'medium',
      resilience: 55,
      matchCount: 0,
      isUnique: false,
    });
  }

  // 6. CSS selector — fallback
  if (raw.cssSelector) {
    const isIdBased = raw.cssSelector.startsWith('#');
    const isTestIdBased = raw.cssSelector.startsWith('[data-testid');
    locators.push({
      strategy: 'css',
      value: raw.cssSelector,
      confidence: 'low',
      resilience: isIdBased ? 45 : isTestIdBased ? 50 : 20,
      matchCount: 0,
      isUnique: false,
    });
  }

  return locators;
}

/**
 * Verify uniqueness without N individual async calls.
 *
 * CSS selectors: single batch page.evaluate() — one querySelectorAll per selector.
 * TestID selectors: small number, verified in parallel via Playwright API.
 * Role/text selectors: left as unknown (matchCount 0, isUnique false) to avoid
 * N expensive Playwright calls; the AI consumer treats isUnique:false as "needs
 * further scoping".
 */
async function batchVerifyUniqueness(
  page: Page,
  elements: ElementLocator[],
): Promise<void> {
  // ── CSS batch ─────────────────────────────────────────────────────────────
  type CSSBatch = { elementId: string; locatorValue: string };
  const cssBatch: CSSBatch[] = [];

  for (const el of elements) {
    for (const l of el.locators) {
      if (l.strategy === 'css') {
        cssBatch.push({ elementId: el.elementId, locatorValue: l.value });
      }
    }
  }

  if (cssBatch.length > 0) {
    try {
      const counts: number[] = await page.evaluate(
        (selectors: string[]) =>
          selectors.map((sel) => {
            try {
              return document.querySelectorAll(sel).length;
            } catch {
              return -1;
            }
          }),
        cssBatch.map((b) => b.locatorValue),
      );

      cssBatch.forEach((entry, i) => {
        const el = elements.find((e) => e.elementId === entry.elementId);
        const loc = el?.locators.find(
          (l) => l.strategy === 'css' && l.value === entry.locatorValue,
        );
        if (loc && counts[i] >= 0) {
          loc.matchCount = counts[i];
          loc.isUnique = counts[i] === 1;
        }
      });
    } catch (error) {
      logger.debug(`LocatorGenerator: CSS batch uniqueness failed — ${(error as Error).message}`);
    }
  }

  // ── TestID batch (Playwright API — usually few elements have testids) ─────
  const testIdLocators: { el: ElementLocator; loc: Locator }[] = [];
  for (const el of elements) {
    for (const loc of el.locators) {
      if (loc.strategy === 'testid') {
        testIdLocators.push({ el, loc });
      }
    }
  }

  if (testIdLocators.length > 0) {
    await Promise.allSettled(
      testIdLocators.slice(0, 80).map(async ({ loc }) => {
        const match = loc.value.match(/getByTestId\('(.+?)'\)/);
        if (!match) return;
        try {
          const count = await page.getByTestId(match[1]).count();
          loc.matchCount = count;
          loc.isUnique = count === 1;
        } catch {
          /* non-fatal */
        }
      }),
    );
  }

  // ── ID-based CSS selectors that start with # are almost always unique ─────
  for (const el of elements) {
    for (const loc of el.locators) {
      if (loc.strategy === 'css' && loc.value.startsWith('#') && loc.matchCount === 0) {
        // Already handled by CSS batch; mark as likely unique if batch didn't run
        loc.matchCount = 1;
        loc.isUnique = true;
      }
    }
  }
}
