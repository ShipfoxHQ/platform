import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {reapStaleSessionClaimsActivity} from './reap-stale-session-claims.js';
import {createReleaseAbandonedSessionClaimsActivity} from './release-abandoned-session-claims.js';

export function createAgentSessionActivities(params: {workflows: WorkflowsModuleClient}) {
  return {
    releaseAbandonedSessionClaimsActivity: createReleaseAbandonedSessionClaimsActivity(
      params.workflows,
    ),
    reapStaleSessionClaimsActivity,
  };
}
