// Developer: Shadow Coderr, Architect
import { PageSnapshot } from '../types/capture';
import { logger } from '../utils/logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class DataValidator {
  validatePageSnapshot(snapshot: PageSnapshot): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate metadata
    if (!snapshot.metadata.captureId) {
      errors.push('Missing captureId in metadata');
    }
    if (!snapshot.metadata.url) {
      errors.push('Missing URL in metadata');
    }
    if (!snapshot.metadata.timestamp) {
      errors.push('Missing timestamp in metadata');
    }

    // Validate DOM snapshot
    if (!snapshot.domSnapshot || snapshot.domSnapshot.length === 0) {
      warnings.push('Empty DOM snapshot');
    }

    // Validate accessibility tree
    if (!snapshot.a11yTree) {
      warnings.push('Missing accessibility tree');
    }

    // Validate locators
    if (!snapshot.locators || !snapshot.locators.elements) {
      warnings.push('Missing locator data');
    }

    // Check for redaction markers
    const snapshotStr = JSON.stringify(snapshot);
    if (snapshotStr.includes('[REDACTED]')) {
      logger.info('Redaction markers found in snapshot - this is expected');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateNetworkEvent(event: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!event.timestamp) {
      errors.push('Missing timestamp in network event');
    }
    if (!event.url) {
      errors.push('Missing URL in network event');
    }
    if (!['request', 'response'].includes(event.type)) {
      errors.push('Invalid event type in network event');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
