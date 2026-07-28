import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      // Test files share real PostgreSQL tables, including administration command state and outbox rows.
      // Keep files serial so one file cannot delete or lock another file's fixtures.
      fileParallelism: false,
      globalSetup: ['test/globalSetup.ts'],
      setupFiles: ['test/setup.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
