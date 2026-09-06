import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      env: {
        API_PUBLIC_URL: 'http://localhost:16101',
        CLIENT_BASE_URL: 'http://localhost:5173',
      },
    },
  },
  import.meta.url,
) as UserConfigExport;
