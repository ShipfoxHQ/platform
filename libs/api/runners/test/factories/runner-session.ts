import {Factory} from 'fishery';
import type {RunnerSession} from '#core/entities/runner-session.js';
import {createRunnerSession} from '#db/runner-sessions.js';

export const runnerSessionFactory = Factory.define<
  RunnerSession,
  unknown,
  RunnerSession,
  Partial<RunnerSession>
>(({onCreate}) => {
  onCreate((session) => {
    return createRunnerSession({
      workspaceId: session.workspaceId,
      scope: session.scope,
      registrationTokenId: session.registrationTokenId,
      labels: session.labels,
      toolCapabilities: session.toolCapabilities,
      lifecycleCapabilities: session.lifecycleCapabilities,
    });
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    scope: 'workspace',
    registrationTokenId: crypto.randomUUID(),
    registrationTokenKind: 'manual',
    runnerInstanceId: null,
    provisionerId: null,
    providerRunnerId: null,
    labels: ['linux', 'x64'],
    toolCapabilities: null,
    toolCapabilitiesReportedAt: null,
    lifecycleCapabilities: null,
    lifecycleCapabilitiesReportedAt: null,
    maxClaims: null,
    claimsUsed: 0,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
