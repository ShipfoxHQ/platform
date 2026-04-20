import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  LOG_LEVEL: str({default: 'info'}),
  LOG_PRETTY: bool({default: false}),
  LOG_STDOUT: bool({default: true}),
  LOG_FILE: str({default: undefined}),
});
