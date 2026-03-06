// Developer: Shadow Coderr, Architect
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
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
