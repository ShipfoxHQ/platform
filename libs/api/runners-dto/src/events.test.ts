import {runnerJobClaimedEventSchema, runnerJobLeaseExpiredEventSchema} from './events.js';

const sharedIdentity = {
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  jobId: 'job-1',
  jobExecutionId: 'execution-1',
};

describe('runner job events', () => {
  it('accepts the enriched claimed event contract', () => {
    const payload = {
      ...sharedIdentity,
      claimedAt: '2026-08-11T08:01:00.000Z',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      runnerLabels: ['linux', 'x64'],
      templateKey: 'linux',
      provisionerId: 'provisioner-1',
      provisionerScope: 'installation' as const,
      providerKind: 'ec2',
      launchKind: 'demand' as const,
    };

    expect(runnerJobClaimedEventSchema.parse(payload)).toEqual(payload);
  });

  it('keeps legacy claimed events valid while the optional fields roll out', () => {
    const payload = {...sharedIdentity, claimedAt: '2026-08-11T08:01:00.000Z'};

    expect(runnerJobClaimedEventSchema.parse(payload)).toEqual(payload);
  });

  it('accepts the lease expiry timestamp', () => {
    const payload = {
      ...sharedIdentity,
      expiredAt: '2026-08-11T08:02:00.000Z',
    };

    expect(runnerJobLeaseExpiredEventSchema.parse(payload)).toEqual(payload);
  });

  it('keeps legacy lease-expired events valid while the optional field rolls out', () => {
    const payload = {...sharedIdentity};

    expect(runnerJobLeaseExpiredEventSchema.parse(payload)).toEqual(payload);
  });

  it.each([
    ['provisionerScope', {provisionerScope: 'organization'}],
    ['launchKind', {launchKind: 'scheduled'}],
  ])('rejects an invalid %s', (_field, invalidField) => {
    const payload = {
      ...sharedIdentity,
      claimedAt: '2026-08-11T08:01:00.000Z',
      ...invalidField,
    };

    expect(() => runnerJobClaimedEventSchema.parse(payload)).toThrow();
  });
});
