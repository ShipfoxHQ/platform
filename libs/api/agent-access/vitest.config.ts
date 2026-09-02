import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      fileParallelism: false,
    },
  },
  import.meta.url,
) as UserConfigExport;
