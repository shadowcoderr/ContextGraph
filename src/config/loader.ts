// Developer: Shadow Coderr, Architect
import * as fs from 'fs-extra';
import * as path from 'path';
import { Config } from '../types/config';
import { DEFAULT_CONFIG } from './defaults';
import { validateConfig } from '../utils/validators';
import { logger } from '../utils/logger';

export async function loadConfig(configPath?: string): Promise<Config> {
  let config = { ...DEFAULT_CONFIG };

  if (configPath) {
    const fullPath = path.resolve(configPath);
    if (await fs.pathExists(fullPath)) {
      try {
        const userConfig = await fs.readJson(fullPath);
        config = mergeConfigs(config, userConfig);
        logger.info(`Loaded config from ${fullPath}`);
      } catch (error) {
        logger.warn(`Failed to load config from ${fullPath}: ${error}`);
      }
    } else {
      logger.warn(`Config file not found: ${fullPath}`);
    }
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
  }

  return config;
}

function mergeConfigs(base: Config, override: Partial<Config>): Config {
  return {
    browser: { ...base.browser, ...override.browser },
    capture: { ...base.capture, ...override.capture },
    security: { ...base.security, ...override.security },
    storage: { ...base.storage, ...override.storage },
  };
}
