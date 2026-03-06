// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import { ElementLocator, Locator, LocatorsData } from '../types/capture';
import { logger } from '../utils/logger';

export class LocatorGenerator {
  async generateLocators(page: Page): Promise<LocatorsData> {
    logger.info('Starting locator generation');
    const elementLocators: ElementLocator[] = [];
    
    try {
      // Wait for page to be fully interactive
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
          logger.debug('Network idle wait timed out, continuing with locator generation');
        });
      } catch (error) {
        logger.warn(`Error waiting for network idle: ${(error as Error).message}`);
      }

      // Try multiple selector strategies to find interactive elements
      const selectorStrategies = [
        // Test attributes first (most reliable)
        { selector: '[data-test]', name: 'data-test' },
        { selector: '[data-testid]', name: 'data-testid' },
        { selector: '[data-cy]', name: 'data-cy' },
        { selector: '[data-qa]', name: 'data-qa' },
        
        // Standard interactive elements
        { selector: 'button:not([disabled])', name: 'button' },
        { selector: 'a[href]:not([href=""])', name: 'link' },
        { selector: 'input:not([type="hidden"]):not([disabled])', name: 'input' },
        { selector: 'select:not([disabled])', name: 'select' },
        { selector: 'textarea:not([disabled])', name: 'textarea' },
        { selector: '[role="button"]', name: 'role=button' },
        { selector: '[role="link"]', name: 'role=link' },
        { selector: '[role="textbox"]', name: 'role=textbox' },
        { selector: '[role="checkbox"]', name: 'role=checkbox' },
        { selector: '[role="radio"]', name: 'role=radio' },
        { selector: '[role="combobox"]', name: 'role=combobox' },
        
        // Fallback to all clickable elements
        { selector: 'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"]', name: 'all-interactive' }
      ];
      
      const seenElements = new Set<string>();
      
      for (const { selector, name } of selectorStrategies) {
        try {
          logger.debug(`Trying selector: ${name} (${selector})`);
          // Use .all() to get all handles
          const elements = await page.locator(selector).all();
          
          for (const element of elements) {
            try {
              // Generate a unique key for the element to avoid duplicates
              // We use evaluate to get DOM properties for the signature
              const elementKey = await element.evaluate((el: HTMLElement) => {
                const tag = el.tagName.toLowerCase();
                const id = el.id ? `#${el.id}` : '';
                const classes = el.className && typeof el.className === 'string' 
                  ? `.${el.className.split(' ').filter(c => c).join('.')}` 
                  : '';
                const nameAttr = (el as any).name ? `[name="${(el as any).name}"]` : '';
                // Add rect to key to distinguish identical elements in different locations
                const rect = el.getBoundingClientRect();
                const pos = `(${Math.round(rect.x)},${Math.round(rect.y)})`;
                
                return `${tag}${id}${classes}${nameAttr}${pos}`;
              }).catch(() => '');
              
              if (!elementKey || seenElements.has(elementKey)) continue;
              seenElements.add(elementKey);
              
              const locator = await this.generateElementLocator(element, elementLocators.length, page);
              if (locator) {
                elementLocators.push(locator);
              }
            } catch (error) {
              // Individual element processing error, skip and continue
              logger.debug(`Error processing element with selector ${name}: ${(error as Error).message}`);
            }
          }
          
        } catch (error) {
          const errorMessage = (error as Error).message;
          // Check for fatal browser closure errors
          if (errorMessage.includes('Target page, context or browser has been closed') ||
              errorMessage.includes('Execution context was destroyed')) {
            logger.warn(`Browser connection lost, stopping locator generation: ${errorMessage}`);
            throw error; // Re-throw to stop the entire process
          }
          logger.warn(`Error with selector ${name} (${selector}): ${errorMessage}`);
        }
      }
      
      logger.info(`Generated locators for ${elementLocators.length} elements`);
      
    } catch (error) {
      logger.error(`Error in generateLocators: ${(error as Error).message}`);
    }
    
    return { elements: elementLocators };
  }

  private async generateElementLocator(element: any, index: number, page: Page): Promise<ElementLocator | null> {
    try {
      const tagName = await element.evaluate((el: HTMLElement) => el.tagName.toLowerCase());
      const text = await element.textContent();
      const attributes = await element.evaluate((el: HTMLElement) => {
        const attrs: Record<string, any> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          attrs[attr.name] = attr.value;
        }
        return attrs;
      });

      const boundingBox = await element.boundingBox();
      const isVisible = await element.isVisible();
      const isEnabled = await element.isEnabled();
      const isEditable = await element.isEditable().catch(() => false);

      // Fix: Only check isChecked for valid types
      let isChecked = false;
      if (tagName === 'input') {
          const type = attributes['type'];
          if (type === 'checkbox' || type === 'radio') {
              isChecked = await element.isChecked().catch(() => false);
          }
      }

      const locators: Locator[] = [];

      // Role-based locator (highest priority)
      const role = await this.getRole(element);
      if (role) {
        const roleLocator = `getByRole('${role.role}'${role.name ? `, { name: '${role.name}' }` : ''})`;
        const matchInfo = await this.getMatchCount(page, 'role', role.role, role.name);
        locators.push({
          strategy: 'role',
          value: roleLocator,
          confidence: 'high',
          resilience: 95,
          matchCount: matchInfo.matchCount,
          isUnique: matchInfo.isUnique,
        });
      }

      // TestID locator
      if (attributes['data-testid']) {
        const testId = attributes['data-testid'];
        const matchInfo = await this.getMatchCount(page, 'testid', testId);
        locators.push({
          strategy: 'testid',
          value: `getByTestId('${testId}')`,
          confidence: 'high',
          resilience: 90,
          matchCount: matchInfo.matchCount,
          isUnique: matchInfo.isUnique,
        });
      } else if (attributes['data-test']) {
        const testId = attributes['data-test'];
        const matchInfo = await this.getMatchCount(page, 'testid', testId);
        locators.push({
          strategy: 'testid',
          value: `getByTestId('${testId}')`,
          confidence: 'high',
          resilience: 90,
          matchCount: matchInfo.matchCount,
          isUnique: matchInfo.isUnique,
        });
      }

      // Label locator for form elements
      if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
        const label = await this.getAssociatedLabel(element); 
        if (label) {
          const matchInfo = await this.getMatchCount(page, 'label', label);
          locators.push({
            strategy: 'label',
            value: `getByLabel('${label}')`,
            confidence: 'high',
            resilience: 85,
            matchCount: matchInfo.matchCount,
            isUnique: matchInfo.isUnique,
          });
        }
      }

      // Placeholder locator
      if (attributes.placeholder) {
        const matchInfo = await this.getMatchCount(page, 'placeholder', attributes.placeholder);
        locators.push({
          strategy: 'placeholder',
          value: `getByPlaceholder('${attributes.placeholder}')`,
          confidence: 'medium',
          resilience: 70,
          matchCount: matchInfo.matchCount,
          isUnique: matchInfo.isUnique,
        });
      }

      // Text locator
      if (text && text.trim().length > 0 && text.trim().length < 50) { // Limit length for text locators
        const matchInfo = await this.getMatchCount(page, 'text', text.trim());
        locators.push({
          strategy: 'text',
          value: `getByText('${text.trim()}')`,
          confidence: 'medium',
          resilience: 60,
          matchCount: matchInfo.matchCount,
          isUnique: matchInfo.isUnique,
        });
      }

      // CSS selector (fallback)
      const cssSelector = await element.evaluate((el: HTMLElement) => {
        const getSelector = (element: HTMLElement): string => {
          if (element.id) return `#${element.id}`;
          if (element.className && typeof element.className === 'string') {
             return `${element.tagName.toLowerCase()}.${element.className.split(' ').filter(c => c).join('.')}`;
          }
          if ((element as any).name) return `${element.tagName.toLowerCase()}[name="${(element as any).name}"]`;
          return element.tagName.toLowerCase();
        };
        return getSelector(el);
      });

      const cssMatchInfo = await this.getMatchCount(page, 'css', cssSelector);
      locators.push({
        strategy: 'css',
        value: cssSelector,
        confidence: 'low',
        resilience: 30,
        matchCount: cssMatchInfo.matchCount,
        isUnique: cssMatchInfo.isUnique,
      });

      const elementId = `elem_${index.toString().padStart(3, '0')}`;
      
      // Add data attribute for later reference (non-destructive if possible, wrap in try/catch)
      try {
        await element.evaluate((el: HTMLElement, id: string) => {
          el.setAttribute('data-cc-element-id', id);
        }, elementId);
      } catch {}

      return {
        elementId,
        tagName,
        text: text?.trim(),
        locators,
        attributes,
        computedState: {
          isVisible,
          isEnabled,
          isChecked,
          isEditable,
          isFocusable: isVisible && isEnabled, // Approximation
        },
        position: boundingBox ? {
          x: boundingBox.x,
          y: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        } : { x: 0, y: 0, width: 0, height: 0 },
      };
    } catch (error) {
      // Skip elements that can't be analyzed
      return null;
    }
  }

  private async getRole(element: any): Promise<{ role: string; name?: string } | null> {
    try {
      const role = await element.getAttribute('role');
      const ariaLabel = await element.getAttribute('aria-label');
      const text = await element.textContent();

      let elementRole = role;
      if (!elementRole) {
        const tagName = await element.evaluate((el: HTMLElement) => el.tagName.toLowerCase());
        const type = await element.getAttribute('type');

        switch (tagName) {
          case 'button': elementRole = 'button'; break;
          case 'input': {
            if (type === 'checkbox') elementRole = 'checkbox';
            else if (type === 'radio') elementRole = 'radio';
            else if (type === 'submit' || type === 'button' || type === 'reset') elementRole = 'button';
            else if (type === 'search') elementRole = 'searchbox';
            else elementRole = 'textbox';
            break;
          }
          case 'select': elementRole = 'combobox'; break;
          case 'textarea': elementRole = 'textbox'; break;
          case 'a': if (await element.getAttribute('href')) elementRole = 'link'; break;
        }
      }

      if (elementRole) {
        return {
          role: elementRole,
          name: ariaLabel || text?.trim(),
        };
      }
    } catch (error) {
      // Ignore
    }
    return null;
  }

  private async getAssociatedLabel(element: any): Promise<string | null> {
    try {
      const label = await element.evaluate((el: HTMLElement) => {
        // Check for aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelElement = document.getElementById(labelledBy);
          return labelElement?.textContent?.trim() || null;
        }

        // Check for associated label via 'for' attribute
        const id = el.id;
        if (id) {
          const labelElement = document.querySelector(`label[for="${id}"]`);
          return labelElement?.textContent?.trim() || null;
        }

        // Check parent label (implicit wrapping)
        const parent = el.parentElement;
        if (parent?.tagName.toLowerCase() === 'label') {
          // Clone and remove the input itself to get just the label text
          const clone = parent.cloneNode(true) as HTMLElement;
          const inputInClone = clone.querySelector(el.tagName);
          if (inputInClone) inputInClone.remove();
          return clone.textContent?.trim() || null;
        }

        return null;
      });

      return label;
    } catch (error) {
      return null;
    }
  }

  /**
   * Calculate match count and uniqueness for a locator strategy
   */
  private async getMatchCount(
    page: Page, 
    strategy: string, 
    value: string, 
    name?: string
  ): Promise<{ matchCount: number; isUnique: boolean }> {
    try {
      let locator: any;
      
      switch (strategy) {
        case 'role':
          locator = name 
            ? page.getByRole(value as any, { name }) 
            : page.getByRole(value as any);
          break;
        case 'testid':
          locator = page.getByTestId(value);
          break;
        case 'label':
          locator = page.getByLabel(value);
          break;
        case 'placeholder':
          locator = page.getByPlaceholder(value);
          break;
        case 'text':
          locator = page.getByText(value);
          break;
        case 'css':
          locator = page.locator(value);
          break;
        default:
          return { matchCount: 0, isUnique: false };
      }

      const count = await locator.count();
      return {
        matchCount: count,
        isUnique: count === 1,
      };
    } catch (error) {
      logger.debug(`Failed to get match count for ${strategy}:${value}: ${(error as Error).message}`);
      return { matchCount: 0, isUnique: false };
    }
  }
}