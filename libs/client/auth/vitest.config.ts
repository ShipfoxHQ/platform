import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      environment: 'jsdom',
      setupFiles: ['test/setup.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
