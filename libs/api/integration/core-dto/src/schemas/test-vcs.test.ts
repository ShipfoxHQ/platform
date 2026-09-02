import {createE2eTestVcsConnectionBodySchema, testVcsStatsDtoSchema} from './test-vcs.js';

describe('Test VCS E2E DTOs', () => {
  it('defaults connection renewal to on-rejection', () => {
    const result = createE2eTestVcsConnectionBodySchema.parse({
      workspace_id: '00000000-0000-4000-8000-000000000001',
      account_id: 'e2e-owner',
    });

    expect(result.renewal_mode).toBe('on-rejection');
  });

  it('rejects a refresh delay for on-rejection renewal', () => {
    const result = createE2eTestVcsConnectionBodySchema.safeParse({
      workspace_id: '00000000-0000-4000-8000-000000000001',
      account_id: 'e2e-owner',
      renewal_mode: 'on-rejection',
      refresh_after_seconds: 1,
    });

    expect(result.success).toBe(false);
  });

  it('accepts redacted fixture observations', () => {
    const result = testVcsStatsDtoSchema.parse({
      mint_count: 1,
      request_count: 1,
      accepted_request_count: 0,
      rejected_request_count: 1,
      generations: ['generation-a'],
      invalidations: [
        {key: 'primary-read', repository: 'e2e-owner/repository', generation: 'generation-a'},
      ],
      requests: [
        {
          method: 'GET',
          path: '/e2e-owner/repository.git/info/refs',
          status: 'rejected',
          generation: 'generation-a',
        },
      ],
    });

    expect(result.invalidations).toHaveLength(1);
  });
});
