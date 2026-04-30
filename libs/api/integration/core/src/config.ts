import {bool, createConfig} from '@shipfox/config';

export const config = createConfig({
  INTEGRATIONS_ENABLE_DEBUG_PROVIDER: bool({default: false}),
  INTEGRATIONS_ENABLE_GITHUB_PROVIDER: bool({default: false}),
});
