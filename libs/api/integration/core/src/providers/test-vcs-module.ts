import {config} from '#config.js';
import type {IntegrationProviderModule} from '#providers/types.js';

export const testVcsProviderModule: IntegrationProviderModule = {
  id: 'test-vcs',
  enabled: config.INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER,
  load: async () =>
    await import('#providers/test-vcs-runtime.js').then((runtime) => runtime.load()),
};
