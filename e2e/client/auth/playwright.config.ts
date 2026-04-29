import {config} from '@shipfox/e2e-core';
import {defineConfig, devices} from '@shipfox/playwright';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/global-setup.ts',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: config.CLIENT_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
  ],
});
