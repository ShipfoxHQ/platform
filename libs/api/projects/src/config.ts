import {bool, createConfig} from '@shipfox/config';

export const config = createConfig({
  PROJECTS_ENABLE_TEST_VCS_PROVIDER: bool({default: false}),
});
