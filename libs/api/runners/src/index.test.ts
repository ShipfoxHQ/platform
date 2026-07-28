import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {createRunnersModule} from './index.js';

const auth = {} as AuthInterModuleClient;

describe('createRunnersModule', () => {
  it('preserves the default module composition when options are absent', () => {
    const module = createRunnersModule({auth});

    expect(module.name).toBe('runners');
    expect(module.auth).toHaveLength(3);
    expect(module.routes).toHaveLength(13);
    expect(module.workers).toHaveLength(1);
  });

  it('accepts an instance-local installation provisioning policy', () => {
    const policy = {
      filterEligibleWorkspaceIds: vi.fn().mockResolvedValue(new Set<string>()),
    };

    const module = createRunnersModule({auth, installationProvisioning: {policy}});

    expect(module.name).toBe('runners');
    expect(policy.filterEligibleWorkspaceIds).not.toHaveBeenCalled();
  });
});
