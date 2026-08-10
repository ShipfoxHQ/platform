import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {runnersAdminCommandResults} from './schema/admin-command-results.js';
import {ephemeralRegistrationTokens} from './schema/ephemeral-registration-tokens.js';
import {manualRegistrationTokens} from './schema/manual-registration-tokens.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {provisionerCapabilitySnapshots} from './schema/provisioner-capability-snapshots.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {runnersRateLimits} from './schema/rate-limits.js';
import {reservations} from './schema/reservations.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerBootstrapTokens, runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';
import {terminalJobExecutions} from './schema/terminal-job-executions.js';

export const schema = {
  runnersAdminCommandResults,
  ephemeralRegistrationTokens,
  pendingJobExecutions,
  providerRunners,
  provisionerCapabilitySnapshots,
  provisionerTokens,
  runnersRateLimits,
  reservations,
  runnerSessions,
  runnerBootstrapTokens,
  runnerControlSessions,
  runnerActivationTokens,
  manualRegistrationTokens,
  runningJobExecutions,
  terminalJobExecutions,
  runnersOutbox,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}

export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
