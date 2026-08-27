import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export type {
  AdministratorRunnerAssignmentFilter,
  AdministratorRunnerInstanceRow,
  ListAdministratorRunnerInstancesParams,
  ListAdministratorRunnerInstancesResult,
} from './admin-runner-instances.js';
export {listAdministratorRunnerInstances} from './admin-runner-instances.js';
export {closeDb, db, schema} from './db.js';
export type {DeleteExpiredEphemeralRegistrationTokensParams} from './ephemeral-registration-tokens.js';
export {deleteExpiredEphemeralRegistrationTokens} from './ephemeral-registration-tokens.js';
export type {
  ClaimedJobExecution,
  EnqueueJobExecutionParams,
  RunnerInstanceBoundJobExecution,
} from './job-executions.js';
export {
  claimPendingJobExecution,
  enqueueJobExecution,
  expireStuckJobExecutions,
  getWorkspaceJobCounts,
  isJobLeaseActive,
  listActiveRunningJobExecutions,
  listRunningJobExecutionsByRunnerInstanceTx,
  recordHeartbeat,
} from './job-executions.js';
export type {CreateManualRegistrationTokenParams} from './manual-registration-tokens.js';
export {
  createManualRegistrationToken,
  listUsableManualRegistrationTokensByWorkspaceId,
  resolveManualRegistrationTokenByHash,
  revokeManualRegistrationToken,
} from './manual-registration-tokens.js';
export {
  hasActiveWorkspaceProvisionerCapability,
  listActiveWorkspaceProvisionerCapabilitySnapshots,
  listStaleWorkspaceProvisionerCapabilitySnapshots,
  publishWorkspaceProvisionerCapabilitySnapshot,
} from './provisioner-capability-snapshots.js';
export type {CreateProvisionerTokenParams} from './provisioner-tokens.js';
export {
  createInstallationProvisionerTokenWithAudit,
  createProvisionerToken,
  listActiveProvisionerTokens,
  listInstallationProvisionerTokens,
  listUsableProvisionerTokensByWorkspaceId,
  resolveProvisionerTokenByHash,
  revokeInstallationProvisionerTokenWithAudit,
  revokeProvisionerToken,
  touchProvisionerLastSeen,
} from './provisioner-tokens.js';
export type {
  DemandStat,
  PollDemandAndReserveParams,
  ReservationGrant,
  ReservationTemplate,
} from './reservations.js';
export {
  deleteExpiredReservations,
  deleteReservationsByIds,
  pollDemandAndReserve,
  releaseReservationUnits,
} from './reservations.js';
export {assignRunnerInstances} from './runner-assignments.js';
export type {
  ActiveRunnerInstanceTemplateCount,
  ReapStaleRunnerInstancesResult,
  ReconcileRunnerInstancesDbResult,
  ReconcileRunnerInstancesParams,
  ReportRunnerInstancesParams,
  RunnerInstanceReportEvent,
  RunnerInstanceTerminateIntent,
  RunnerInstanceTerminateIntentReason,
  RunnerTerminationReason,
  TerminationAuthorizationResult,
} from './runner-instances.js';
export {
  attachRunnerInstanceProviderId,
  countStaleEnrolledRunnerInstances,
  isTerminalState,
  listActiveRunnerInstanceCountsByTemplateTx,
  listActiveRunnerInstances,
  listProvisionerTerminateIntentRowsTx,
  listProvisionerTerminateIntents,
  reapStaleRunnerInstances,
  reconcileRunnerInstances,
  reportRunnerInstances,
} from './runner-instances.js';
export type {
  CreateRunnerSessionParams,
  DeleteExpiredRunnerSessionsParams,
} from './runner-sessions.js';
export {createRunnerSession, deleteExpiredRunnerSessions} from './runner-sessions.js';
export {runnersOutbox} from './schema/outbox.js';
export {runnerBootstrapTokens, runnerControlSessions} from './schema/runner-control-sessions.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
