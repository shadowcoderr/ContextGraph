// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import { AccessibilityTree } from '../types/capture';
import { logger } from '../utils/logger';

/**
 * AccessibilityExtractor — captures the full accessibility tree using three
 * strategies in order of reliability:
 *
 * 1. Playwright's built-in accessibility.snapshot() — the most reliable,
 *    cross-browser approach.  Configured with interestingOnly: false so every
 *    node is returned, not just "interesting" leaf nodes.
 *
 * 2. Chrome DevTools Protocol (CDP) Accessibility.getFullAXTree — lower-level
 *    but gives raw browser data when Playwright's API is unavailable.
 *
 * 3. DOM-based construction — pure JavaScript executed inside the page.
 *    Works in every environment but misses computed ARIA states.
 */
export class AccessibilityExtractor {
  async extract(page: Page, includeHidden: boolean = false): Promise<AccessibilityTree> {
    // ── Strategy 1: Playwright accessibility.snapshot() ──────────────────────
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

      // `interestingOnly: false` returns every node; set to true for compact trees
      const snapshot = await (page as any).accessibility.snapshot({
        interestingOnly: !includeHidden,
      });

      if (snapshot) {
        logger.debug('A11y: using Playwright snapshot strategy');
        return this.transformPlaywrightSnapshot(snapshot);
      }
    } catch (e) {
      logger.debug(`A11y Playwright strategy failed: ${(e as Error).message}`);
    }

    // ── Strategy 2: CDP Accessibility.getFullAXTree ───────────────────────────
    try {
      const client = await (page.context() as any).newCDPSession(page);
      const result = await client.send('Accessibility.getFullAXTree');
      await client.detach().catch(() => {});

      if (result?.nodes?.length) {
        logger.debug('A11y: using CDP strategy');
        return this.transformCDPSnapshot(result.nodes[0], result.nodes);
      }
    } catch (e) {
      logger.debug(`A11y CDP strategy failed: ${(e as Error).message}`);
    }

    // ── Strategy 3: DOM-based fallback ────────────────────────────────────────
    try {
      const domResult = await this.buildFromDOM(page, includeHidden);
      logger.debug('A11y: using DOM fallback strategy');
      return this.transformSnapshot(domResult);
    } catch (e) {
      logger.warn(`A11y DOM strategy failed: ${(e as Error).message}`);
    }

    // ── Ultimate fallback ─────────────────────────────────────────────────────
    logger.warn('A11y: all strategies failed, returning minimal tree');
    return {
      role: 'WebArea',
      name: await page.title().catch(() => ''),
      children: [],
    };
  }

  // ── Playwright snapshot transformation ──────────────────────────────────────

  private transformPlaywrightSnapshot(node: any): AccessibilityTree {
    const result: AccessibilityTree = {
      role: node.role || 'generic',
      name: node.name || '',
      children: Array.isArray(node.children)
        ? node.children.map((c: any) => this.transformPlaywrightSnapshot(c))
        : [],
    };

    if (node.value !== undefined && node.value !== null) result.value = String(node.value);
    if (typeof node.required === 'boolean') result.required = node.required;
    if (typeof node.disabled === 'boolean') result.disabled = node.disabled;
    if (typeof node.focused === 'boolean') result.focused = node.focused;
    if (typeof node.multiline === 'boolean') result.multiline = node.multiline;
    if (node.checked !== undefined) result.checked = node.checked;
    if (node.pressed !== undefined) result.pressed = node.pressed;
    if (typeof node.selected === 'boolean') result.selected = node.selected;
    if (typeof node.expanded === 'boolean') result.expanded = node.expanded;
    if (typeof node.level === 'number') result.level = node.level;

    return result;
  }

  // ── CDP snapshot transformation ──────────────────────────────────────────────

  private transformCDPSnapshot(rootNode: any, allNodes: any[]): AccessibilityTree {
    const nodeMap = new Map<string, any>();
    for (const n of allNodes) nodeMap.set(n.nodeId, n);

    const buildNode = (node: any): AccessibilityTree => {
      const children: AccessibilityTree[] = [];

      if (Array.isArray(node.childIds)) {
        for (const childId of node.childIds) {
          const childNode = nodeMap.get(childId);
          if (childNode) children.push(buildNode(childNode));
        }
      }

      const getProp = (name: string) =>
        node.properties?.find((p: any) => p.name === name)?.value?.value;

      const result: AccessibilityTree = {
        role: node.role?.value || 'generic',
        name: node.name?.value || '',
        children,
      };

      if (node.value?.value !== undefined) result.value = String(node.value.value);

      const required = getProp('required');
      if (required !== undefined) result.required = required === true;

      const disabled = getProp('disabled');
      if (disabled !== undefined) result.disabled = disabled === true;

      const focused = getProp('focused');
      if (focused !== undefined) result.focused = focused === true;

      const checked = getProp('checked');
      if (checked !== undefined) result.checked = checked;

      const pressed = getProp('pressed');
      if (pressed !== undefined) result.pressed = pressed;

      const selected = getProp('selected');
      if (selected !== undefined) result.selected = selected === true;

      const expanded = getProp('expanded');
      if (expanded !== undefined) result.expanded = expanded === true;

      return result;
    };

    return buildNode(rootNode);
  }

  // ── DOM-based fallback ───────────────────────────────────────────────────────

  /**
   * Build an accessibility tree by traversing the live DOM inside the page.
   * This approach works universally but misses computed ARIA states and
   * relationships that only the accessibility engine can resolve.
   */
  private async buildFromDOM(page: Page, includeHidden: boolean): Promise<any> {
    return await page.evaluate((opts: { includeHidden: boolean }) => {
      const ROLE_MAP: Record<string, string> = {
        BUTTON: 'button',
        INPUT: 'textbox',   // refined below
        TEXTAREA: 'textbox',
        SELECT: 'combobox',
        A: 'link',
        IMG: 'img',
        FORM: 'form',
        NAV: 'navigation',
        HEADER: 'banner',
        FOOTER: 'contentinfo',
        MAIN: 'main',
        ASIDE: 'complementary',
        SECTION: 'region',
        ARTICLE: 'article',
        DIALOG: 'dialog',
        TABLE: 'table',
        UL: 'list',
        OL: 'list',
        LI: 'listitem',
        H1: 'heading', H2: 'heading', H3: 'heading',
        H4: 'heading', H5: 'heading', H6: 'heading',
        DETAILS: 'group',
        SUMMARY: 'button',
      };

      const INPUT_ROLE_MAP: Record<string, string> = {
        checkbox: 'checkbox',
        radio: 'radio',
        submit: 'button',
        button: 'button',
        reset: 'button',
        range: 'slider',
        search: 'searchbox',
        number: 'spinbutton',
        image: 'button',
      };

      function getRole(el: Element): string {
        const explicit = el.getAttribute('role');
        if (explicit) return explicit;

        const tag = el.tagName.toUpperCase();

        if (tag === 'INPUT') {
          const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
          return INPUT_ROLE_MAP[type] || 'textbox';
        }

        if (tag === 'A') {
          return (el as HTMLAnchorElement).href ? 'link' : 'generic';
        }

        if (/^H[1-6]$/.test(tag)) return 'heading';

        return ROLE_MAP[tag] || 'generic';
      }

      function getAccessibleName(el: Element): string {
        // 1. aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const ids = labelledBy.split(/\s+/);
          const texts = ids.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
          if (texts.length) return texts.join(' ');
        }

        // 2. aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim();

        // 3. For img/input, alt or title
        const alt = el.getAttribute('alt');
        if (alt) return alt.trim();

        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return placeholder.trim();

        // 4. For labeled inputs
        const id = el.id;
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label) return label.textContent?.trim() || '';
        }

        // 5. Text content (limited)
        const text = (el as HTMLElement).innerText?.trim();
        if (text) return text.substring(0, 200);

        // 6. title attribute
        const title = el.getAttribute('title');
        if (title) return title.trim();

        return '';
      }

      function isHidden(el: Element): boolean {
        if (!opts.includeHidden) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return true;
          if (el.getAttribute('aria-hidden') === 'true') return true;
        }
        return false;
      }

      function buildNode(el: Element): any | null {
        if (isHidden(el)) return null;

        const role = getRole(el);
        const name = getAccessibleName(el);
        const children: any[] = [];

        for (let i = 0; i < el.children.length; i++) {
          const child = buildNode(el.children[i]);
          if (child) children.push(child);
        }

        const node: any = { role, name, children };

        // Computed states
        const inputEl = el as HTMLInputElement;
        if (el.hasAttribute('disabled') || inputEl.disabled) node.disabled = true;
        if (el.hasAttribute('required') || inputEl.required) node.required = true;
        if (inputEl.checked !== undefined && (inputEl.type === 'checkbox' || inputEl.type === 'radio')) {
          node.checked = inputEl.checked;
        }
        const expanded = el.getAttribute('aria-expanded');
        if (expanded !== null) node.expanded = expanded === 'true';

        const selected = el.getAttribute('aria-selected');
        if (selected !== null) node.selected = selected === 'true';

        const level = el.getAttribute('aria-level');
        if (level !== null) node.level = parseInt(level, 10);
        else if (/^H([1-6])$/.test(el.tagName)) {
          node.level = parseInt(el.tagName[1], 10);
        }

        const value = (el as HTMLInputElement).value;
        if (value !== undefined && value !== '' && inputEl.type !== 'password') {
          node.value = value;
        }

        return node;
      }

      return buildNode(document.documentElement);
    }, { includeHidden });
  }

  // ── Generic snapshot transformer ────────────────────────────────────────────

  private transformSnapshot(node: any): AccessibilityTree {
    if (!node) return { role: 'generic', name: '', children: [] };

    return {
      role: node.role || 'generic',
      name: node.name || '',
      children: Array.isArray(node.children)
        ? node.children.map((c: any) => this.transformSnapshot(c))
        : [],
      value: node.value,
      required: node.required,
      disabled: node.disabled,
      focused: node.focused,
      multiline: node.multiline,
      protected: node.protected,
      checked: node.checked,
      pressed: node.pressed,
      selected: node.selected,
      expanded: node.expanded,
      level: node.level,
    };
  }
}
