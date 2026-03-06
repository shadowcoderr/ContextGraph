// Developer: Shadow Coderr, Architect
import { ComponentsRegistry, ComponentPattern } from '../types/registry';
import { LocatorsData } from '../types/capture';

/**
 * Generate initialization prompt for downstream LLMs
 * This prompt instructs LLMs on how to use locator candidates and components registry
 */
export function generateLLMInitPrompt(
  domain: string,
  componentsRegistry?: ComponentsRegistry,
  pageLocators?: Map<string, LocatorsData>
): string {
  const sections: string[] = [
    '# ContextGraph - LLM Integration Guide',
    '',
    '## Overview',
    `This guide helps you generate robust Playwright locators for the **${domain}** domain.`,
    'Use the locator candidates and components registry as your primary inputs for automated locator generation.',
    '',
  ];

  // Add components registry section if available
  if (componentsRegistry && componentsRegistry.components.length > 0) {
    sections.push(
      '## Components Registry',
      '',
      'The components registry tracks reusable UI patterns identified across captured pages.',
      'Each component includes recommended locators with match counts and uniqueness flags.',
      '',
      '### Component Types',
      '',
      ...formatComponentTypes(componentsRegistry),
      '',
      '### Most Common Components',
      '',
      ...formatMostCommonComponents(componentsRegistry),
      '',
      '### All Components',
      '',
      '```json',
      JSON.stringify(formatComponentsForLLM(componentsRegistry.components), null, 2),
      '```',
      ''
    );
  }

  // Add page locators section if available
  if (pageLocators && pageLocators.size > 0) {
    sections.push(
      '## Page Locator Candidates',
      '',
      'For each page, locator candidates with match counts and uniqueness are provided.',
      '**Always prefer unique locators (isUnique: true) for reliable element selection.**',
      ''
    );

    for (const [pageName, locatorsData] of pageLocators) {
      sections.push(
        `### Page: ${pageName}`,
        '',
        '```json',
        JSON.stringify(formatLocatorsForLLM(locatorsData), null, 2),
        '```',
        ''
      );
    }
  }

  // Add locator generation guidelines
  sections.push(
    '## Locator Generation Guidelines',
    '',
    '### Priority Order (Highest to Lowest Reliability)',
    '',
    '1. **Test ID Locators** (`getByTestId`) - Most reliable, use when available',
    '2. **Role Locators** (`getByRole`) - Semantic and resilient to DOM changes',
    '3. **Label Locators** (`getByLabel`) - Good for form elements',
    '4. **Placeholder Locators** (`getByPlaceholder`) - Acceptable for inputs',
    '5. **Text Locators** (`getByText`) - Use with caution, text may change',
    '6. **CSS Selectors** - Last resort, fragile to structure changes',
    '',
    '### Using Match Counts and Uniqueness',
    '',
    '- `matchCount: 1` and `isUnique: true` → **Use this locator**',
    '- `matchCount: N` and `isUnique: false` → Locator matches multiple elements, refine or combine',
    '- Always verify uniqueness before using a locator in tests',
    '',
    '### Component-Based Locators',
    '',
    'When targeting a known UI component (e.g., login button, navigation menu):',
    '1. Check the Components Registry for the component pattern',
    '2. Use the `bestLocators` array which contains pre-validated unique locators',
    '3. Consider the component\'s `occurrences` to understand where it appears',
    '',
    '### Example Usage',
    '',
    '```typescript',
    '// ✅ Good: Using unique test ID from locator candidates',
    "await page.getByTestId('login-button').click();",
    '',
    '// ✅ Good: Using role locator with name from component registry',
    "await page.getByRole('button', { name: 'Sign In' }).click();",
    '',
    '// ❌ Avoid: Non-unique text locator',
    "await page.getByText('Submit').click(); // May match multiple elements",
    '',
    '// ✅ Better: Combine with parent context for uniqueness',
    "await page.locator('form').getByRole('button', { name: 'Submit' }).click();",
    '```',
    '',
    '## Best Practices',
    '',
    '1. **Always check `isUnique` flag** - Never use a locator with `isUnique: false` without refinement',
    '2. **Prefer test IDs** - They are intentionally added for testing and most stable',
    '3. **Use semantic roles** - `getByRole` is more resilient than CSS selectors',
    '4. **Leverage components** - Reusable patterns reduce duplication in tests',
    '5. **Verify match counts** - A high `matchCount` indicates potential flakiness',
    '6. **Consider context** - Sometimes a non-unique locator becomes unique within a parent scope',
    '',
    '## Output Format',
    '',
    'When generating locators, output them in this format:',
    '',
    '```typescript',
    '// Component: {componentName}',
    '// Page: {pageName}',
    '// Confidence: {confidence}',
    'const locator = page.{method}({selector});',
    '```',
    ''
  );

  return sections.join('\n');
}

/**
 * Format component types summary
 */
function formatComponentTypes(registry: ComponentsRegistry): string[] {
  const lines: string[] = [];
  const byType = registry.statistics.byType;
  
  for (const [type, count] of Object.entries(byType)) {
    lines.push(`- **${type}**: ${count} component(s)`);
  }
  
  return lines;
}

/**
 * Format most common components
 */
function formatMostCommonComponents(registry: ComponentsRegistry): string[] {
  const lines: string[] = [];
  const mostCommon = registry.statistics.mostCommon.slice(0, 5);
  
  for (const componentId of mostCommon) {
    const component = registry.components.find(c => c.componentId === componentId);
    if (component) {
      lines.push(`- **${component.name}** (${component.type}): ${component.metadata.totalOccurrences} occurrences`);
    }
  }
  
  return lines;
}

/**
 * Format components for LLM consumption (simplified)
 */
function formatComponentsForLLM(components: ComponentPattern[]): any[] {
  return components.map(c => ({
    id: c.componentId,
    name: c.name,
    type: c.type,
    bestLocators: c.bestLocators.map(l => ({
      strategy: l.strategy,
      value: l.value,
      isUnique: l.isUnique,
      matchCount: l.matchCount,
    })),
    occurrences: c.occurrences.length,
    stability: c.metadata.avgStability,
  }));
}

/**
 * Format locators data for LLM consumption
 */
function formatLocatorsForLLM(locatorsData: LocatorsData): any {
  return {
    elementCount: locatorsData.elements.length,
    elements: locatorsData.elements.slice(0, 50).map(e => ({
      id: e.elementId,
      tag: e.tagName,
      text: e.text?.substring(0, 50),
      locators: e.locators.map(l => ({
        strategy: l.strategy,
        value: l.value,
        confidence: l.confidence,
        isUnique: l.isUnique,
        matchCount: l.matchCount,
      })),
    })),
  };
}

/**
 * Generate a quick reference card for locator strategies
 */
export function generateLocatorQuickRef(): string {
  return `
# Locator Strategy Quick Reference

| Strategy | Method | Reliability | Use Case |
|----------|--------|-------------|----------|
| Test ID | \`getByTestId('id')\` | ⭐⭐⭐⭐⭐ | Best for stable test attributes |
| Role | \`getByRole('button')\` | ⭐⭐⭐⭐ | Semantic, accessible elements |
| Label | \`getByLabel('Email')\` | ⭐⭐⭐⭐ | Form fields with labels |
| Placeholder | \`getByPlaceholder('Search')\` | ⭐⭐⭐ | Input fields |
| Text | \`getByText('Submit')\` | ⭐⭐ | Buttons, links (verify uniqueness) |
| CSS | \`locator('.class')\` | ⭐ | Last resort, structure-dependent |

## Uniqueness Indicators

| Flag | Meaning | Action |
|------|---------|--------|
| \`isUnique: true\` | Matches exactly 1 element | ✅ Safe to use directly |
| \`isUnique: false\` | Matches multiple elements | ⚠️ Refine with parent context |
| \`matchCount: 0\` | No matches found | ❌ Locator invalid, regenerate |

## Component Registry Usage

1. Identify the UI component type (button, navigation, form, etc.)
2. Look up the component in the registry
3. Use the \`bestLocators\` array for pre-validated locators
4. Check \`avgStability\` score (higher = more reliable)
`.trim();
}
