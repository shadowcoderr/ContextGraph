// Developer: Shadow Coderr, Architect

/**
 * Normalise a raw user-entered URL.
 * Accepts "https://example.com", "http://example.com", and bare "example.com".
 * Always returns a string with an explicit https:// prefix.
 */
export function normalizeUrl(input: string): string {
  if (!input) return input;
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Returns true when the string is a syntactically valid http/https URL.
 * Bare hostnames (e.g. "saucedemo.com") are accepted — they are normalised
 * to https:// internally before parsing.
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const normalised = normalizeUrl(url);
    const parsed = new URL(normalised);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidDirectory(path: string): boolean {
  return typeof path === 'string' && path.length > 0;
}

export function validateConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.browser) {
    errors.push('Browser configuration is required');
  } else {
    if (!['msedge', 'chromium', 'firefox'].includes(config.browser.channel)) {
      errors.push('Invalid browser channel');
    }
    if (typeof config.browser.headless !== 'boolean') {
      errors.push('Headless must be a boolean');
    }
  }

  if (!config.capture) {
    errors.push('Capture configuration is required');
  }

  if (!config.security) {
    errors.push('Security configuration is required');
  }

  if (!config.storage) {
    errors.push('Storage configuration is required');
  } else {
    if (!isValidDirectory(config.storage.outputDir)) {
      errors.push('Invalid output directory');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
