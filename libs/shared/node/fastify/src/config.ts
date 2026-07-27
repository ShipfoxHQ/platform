import {createConfig, host, num, str} from '@shipfox/config';

export const config = createConfig({
  BROWSER_ALLOWED_ORIGIN: str({
    desc: 'Origins allowed to call the API from a browser (CORS). Accepts one origin or a comma-separated list, including wildcard subdomain origins such as https://*.preview.example.com. Wildcards must be in the leftmost hostname label and must name a specific parent host. Bare public-suffix wildcards are rejected at startup. Falls back to CLIENT_BASE_URL when unset.',
    default: undefined,
  }),
  CLIENT_BASE_URL: str({
    desc: 'Base URL of the client app. Used as the allowed browser origin when BROWSER_ALLOWED_ORIGIN is unset.',
    default: 'http://localhost:3000',
  }),
  HOST: host({
    desc: 'Network address the server binds to. The default 0.0.0.0 listens on all interfaces.',
    default: '0.0.0.0',
  }),
  PORT: num({
    desc: 'Port the server listens on.',
    default: 3000,
  }),
});
