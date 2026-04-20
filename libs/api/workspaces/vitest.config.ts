import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      globalSetup: ['test/globalSetup.ts'],
      setupFiles: ['test/setup.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
