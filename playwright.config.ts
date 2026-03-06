// Developer: Shadow Coderr, Architect
import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: 'playwright-tests',
  timeout: 5 * 60 * 1000,
  expect: {
    timeout: 5000,
  },
  reporter: 'list',
};

export default config;
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  use: {
    headless: true,
  },
});