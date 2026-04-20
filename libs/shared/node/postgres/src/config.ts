import {createConfig, host, num, str} from '@shipfox/config';

export const config = createConfig({
  POSTGRES_HOST: host({default: 'localhost'}),
  POSTGRES_PORT: num({default: 5432}),
  POSTGRES_USERNAME: str({default: 'shipfox'}),
  POSTGRES_PASSWORD: str({default: 'password'}),
  POSTGRES_DATABASE: str({default: 'api'}),
  POSTGRES_MAX_CONNECTIONS: num({default: 10}),
});
