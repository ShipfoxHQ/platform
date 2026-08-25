import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {reapStaleSessionClaimsActivity} from './reap-stale-session-claims.js';
import {createReleaseAbandonedSessionClaimsActivity} from './release-abandoned-session-claims.js';
import {sessionRetentionSweepActivity} from './session-retention-sweep.js';

export function createAgentSessionActivities(params: {
  workflows?: WorkflowsModuleClient | undefined;
}) {
  return {
    releaseAbandonedSessionClaimsActivity: createReleaseAbandonedSessionClaimsActivity(
      params.workflows,
    ),
    reapStaleSessionClaimsActivity,
    sessionRetentionSweepActivity,
  };
}
