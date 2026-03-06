// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import { AccessibilityTree } from '../types/capture';

export class AccessibilityExtractor {
  async extract(page: Page, _includeHidden: boolean = false): Promise<AccessibilityTree> {
    try {
      // Wait for page to be ready
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      
      // Try to get accessibility snapshot via CDP
      let snapshot: any = null;
      
      try {
        // Use CDP (Chrome DevTools Protocol) for accessibility snapshot
        const client = await (page.context() as any).newCDPSession(page);
        snapshot = await client.send('Accessibility.getFullAXTree');
        
        if (snapshot && snapshot.nodes && snapshot.nodes.length > 0) {
          // Transform CDP format to our format
          return this.transformCDPSnapshot(snapshot.nodes[0], snapshot.nodes);
        }
      } catch (cdpError) {
        // CDP not available, fall through to DOM-based approach
      }

      // Fallback: build accessibility tree from DOM
      snapshot = await this.buildFromDOM(page);
      return this.transformSnapshot(snapshot);
    } catch (error) {
      // Final fallback: build from DOM
      try {
        const domSnapshot = await this.buildFromDOM(page);
        return this.transformSnapshot(domSnapshot);
      } catch (domError) {
        // Ultimate fallback
        return {
          role: 'WebArea',
          name: await page.title().catch(() => ''),
          children: [],
        };
      }
    }
  }

  /**
   * Transform CDP accessibility tree format to our format
   */
  private transformCDPSnapshot(rootNode: any, allNodes: any[]): AccessibilityTree {
    const buildNode = (node: any): AccessibilityTree => {
      const children: AccessibilityTree[] = [];
      
      if (node.childIds && node.childIds.length > 0) {
        for (const childId of node.childIds) {
          const childNode = allNodes.find((n: any) => n.nodeId === childId);
          if (childNode) {
            children.push(buildNode(childNode));
          }
        }
      }
      
      const result: AccessibilityTree = {
        role: node.role?.value || 'unknown',
        name: node.name?.value || '',
        children: children.length > 0 ? children : [],
        value: node.value?.value,
        required: node.properties?.find((p: any) => p.name === 'required')?.value?.value === true,
        disabled: node.properties?.find((p: any) => p.name === 'disabled')?.value?.value === true,
        focused: node.properties?.find((p: any) => p.name === 'focused')?.value?.value === true,
      };
      
      // Add optional properties only if they exist
      const checked = node.properties?.find((p: any) => p.name === 'checked')?.value?.value;
      if (checked !== undefined) result.checked = checked;
      
      const pressed = node.properties?.find((p: any) => p.name === 'pressed')?.value?.value;
      if (pressed !== undefined) result.pressed = pressed;
      
      const selected = node.properties?.find((p: any) => p.name === 'selected')?.value?.value;
      if (selected !== undefined) result.selected = selected;
      
      const expanded = node.properties?.find((p: any) => p.name === 'expanded')?.value?.value;
      if (expanded !== undefined) result.expanded = expanded;
      
      return result;
    };
    
    return buildNode(rootNode);
  }

  /**
   * Build accessibility tree from DOM when Playwright accessibility API is unavailable
   */
  private async buildFromDOM(page: Page): Promise<any> {
    return await page.evaluate(() => {
      const buildA11yNode = (element: Element): any => {
        const role = element.getAttribute('role') || 
                    (element.tagName === 'BUTTON' ? 'button' :
                     element.tagName === 'INPUT' ? 'textbox' :
                     element.tagName === 'A' ? 'link' :
                     element.tagName === 'FORM' ? 'form' :
                     element.tagName === 'HEADER' ? 'banner' :
                     element.tagName === 'NAV' ? 'navigation' :
                     element.tagName === 'MAIN' ? 'main' :
                     element.tagName === 'FOOTER' ? 'contentinfo' : 'generic');
        
        const name = element.getAttribute('aria-label') ||
                    element.getAttribute('aria-labelledby') ||
                    (element as HTMLElement).innerText?.trim() ||
                    element.getAttribute('alt') ||
                    element.getAttribute('title') ||
                    '';
        
        const children: any[] = [];
        for (let i = 0; i < element.children.length; i++) {
          const child = buildA11yNode(element.children[i]);
          if (child) children.push(child);
        }
        
        const result: any = {
          role,
          name: name.substring(0, 100), // Limit name length
          children: children.length > 0 ? children : [],
          disabled: element.hasAttribute('disabled'),
          required: element.hasAttribute('required'),
        };
        
        const checked = (element as HTMLInputElement).checked;
        if (checked) result.checked = checked;
        
        const expanded = element.getAttribute('aria-expanded') === 'true';
        if (expanded) result.expanded = expanded;
        
        return result;
      };
      
      return buildA11yNode(document.documentElement);
    });
  }

  private transformSnapshot(snapshot: any): AccessibilityTree {
    return {
      role: snapshot.role || 'unknown',
      name: snapshot.name || '',
      children: snapshot.children ? snapshot.children.map((child: any) => this.transformSnapshot(child)) : [],
      value: snapshot.value,
      required: snapshot.required,
      disabled: snapshot.disabled,
      focused: snapshot.focused,
      multiline: snapshot.multiline,
      protected: snapshot.protected,
      checked: snapshot.checked,
      pressed: snapshot.pressed,
      selected: snapshot.selected,
      expanded: snapshot.expanded,
      level: snapshot.level,
    };
  }
}
