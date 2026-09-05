import {createConfig, str, url} from '@shipfox/config';

const DEFAULT_API_URL = 'http://localhost:16101';
const DEFAULT_CLIENT_URL = 'http://localhost:5173';

export const config = createConfig({
  API_URL: str({
    desc: 'Base URL of the API that the end-to-end tests run against.',
    default: DEFAULT_API_URL,
  }),
  API_PUBLIC_URL: url({
    desc: 'Public API URL advertised by OAuth flows during end-to-end tests. Set it to an absolute URL including the scheme. Defaults to API_URL.',
    default: process.env.API_URL ?? DEFAULT_API_URL,
  }),
  CLIENT_URL: str({
    desc: 'Base URL of the client app that the end-to-end tests run against.',
    default: DEFAULT_CLIENT_URL,
  }),
  CLIENT_BASE_URL: url({
    desc: 'Public client URL accepted by API origin checks during end-to-end tests. Set it to an absolute URL including the scheme. Defaults to CLIENT_URL.',
    default: process.env.CLIENT_URL ?? DEFAULT_CLIENT_URL,
  }),
  E2E_ADMIN_API_KEY: str({
    desc: "Bearer token the end-to-end tests use to call the API's E2E admin routes. Must match the API's E2E_ADMIN_API_KEY.",
    default: 'e2e-admin-api-key',
  }),
});
