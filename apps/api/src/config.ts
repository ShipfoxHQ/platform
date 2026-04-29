import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  E2E_ENABLED: bool({default: false}),
  E2E_ADMIN_API_KEY: str({default: undefined}),
});
