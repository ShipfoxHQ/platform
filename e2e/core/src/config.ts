import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  API_URL: str({default: 'http://localhost:16101'}),
  CLIENT_URL: str({default: 'http://localhost:5173'}),
  E2E_ADMIN_API_KEY: str({default: 'e2e-admin-api-key'}),
});
