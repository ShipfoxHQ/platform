import {createConfig, host, num, str} from '@shipfox/config';

export const config = createConfig({
  BROWSER_ALLOWED_ORIGIN: str({default: undefined}),
  CLIENT_BASE_URL: str({default: 'http://localhost:3000'}),
  HOST: host({default: '0.0.0.0'}),
  PORT: num({default: 3000}),
});
