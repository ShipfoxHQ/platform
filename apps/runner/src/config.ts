import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_API_URL: str(),
  SHIPFOX_POLL_INTERVAL_MS: num({default: 5000}),
  SHIPFOX_POLL_MAX_INTERVAL_MS: num({default: 30000}),
  SHIPFOX_RUNNER_TOKEN: str({default: 'static-poc-token'}),
});
