import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  TOKEN_ENVIRONMENT: str({default: undefined}),
});
