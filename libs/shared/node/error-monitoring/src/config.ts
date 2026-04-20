import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SENTRY_DSN: str({default: undefined}),
  SENTRY_ENVIRONMENT: str({default: undefined}),
  SENTRY_IMAGE: str({default: undefined}),
});
