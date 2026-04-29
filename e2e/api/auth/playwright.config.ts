import {defineConfig} from '@shipfox/playwright';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/global-setup.ts',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
