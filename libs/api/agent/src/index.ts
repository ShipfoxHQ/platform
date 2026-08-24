import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {
  assertAgentConfig,
  validateAgentSessionReapAfterSeconds,
  workspaceProvidersPolicy,
} from '#config.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {db, migrationsPath} from '#db/index.js';
import {createAgentE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createAgentInterModulePresentation} from '#presentation/inter-module.js';
import {createAgentRoutes} from '#presentation/routes/index.js';
import {onJobTerminated} from '#presentation/subscribers/on-job-terminated.js';
import {onStepAttemptTerminated} from '#presentation/subscribers/on-step-attempt-terminated.js';
import {createAgentSessionActivities} from '#temporal/activities/index.js';
import {AGENT_SESSION_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

export {
  type AgentConfigResolutionContext,
  type AgentDefaultsResolver,
  type AgentWorkspaceSettings,
  buildModelProviderCatalog,
  type ContextualAgentConfig,
  catalogDefaultAgentResolver,
  createCustomModelProviderConfig,
  createWorkspaceAgentDefaultsResolver,
  deleteModelProviderConfig,
  getModelProviderCredentialKeys,
  getModelProviderEntry,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  isReservedModelProviderId,
  listSupportedModelProviders,
  type ModelProviderConfig,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
  ModelProviderValidationUnavailableError,
  modelProviderCredentialKeysMatch,
  type ResolvedAgentConfig,
  type ResolveRuntimeCredentialsParams,
  resolveAgentConfig,
  resolveRuntimeCredentials,
  testAndSaveModelProviderConfig,
  UnsupportedModelProviderError,
  updateCustomModelProviderConfig,
  WorkspaceProvidersDisabledError,
} from '#core/index.js';
export {
  getAgentWorkspaceSettings,
  getModelProviderConfig,
  listModelProviderConfigs,
  setDefaultModelProvider,
  upsertModelProviderConfig,
} from '#db/index.js';

export function createAgentModule(params: {
  secrets: AgentSecretsClient;
  managedProvider?: ManagedModelProvider | undefined;
  workflows: WorkflowsModuleClient;
  jobLeaseTokenTtlSeconds: number;
}): ShipfoxModule {
  assertAgentConfig(params.managedProvider);
  validateAgentSessionReapAfterSeconds(params.jobLeaseTokenTtlSeconds);

  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');
  const subscriber = subscriberFactory<WorkflowsEventMapDto>();

  return {
    name: 'agent',
    database: {db, migrationsPath, databaseNamespace: 'agent'},
    routes: createAgentRoutes(params.secrets, {
      managedProvider: params.managedProvider,
      workspaceProviders: workspaceProvidersPolicy,
    }),
    e2eRoutes: [
      createAgentE2eRoutes(params.secrets, {
        managedProviderId: params.managedProvider?.id,
        workspaceProviders: workspaceProvidersPolicy,
      }),
    ],
    interModulePresentations: [
      createAgentInterModulePresentation({
        ...params,
        workspaceProviders: workspaceProvidersPolicy,
      }),
    ],
    // Session claims are released on the same signals that close log streams:
    // the step-attempt-terminated event, the job-terminated grace sweep, and a
    // stale-claim reap cron as the last safety net.
    subscribers: [
      subscriber(WORKFLOWS_STEP_ATTEMPT_TERMINATED, onStepAttemptTerminated),
      subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated),
    ],
    workers: [
      {
        taskQueue: AGENT_SESSION_LIFECYCLE_TASK_QUEUE,
        workflowsPath,
        activities: () => createAgentSessionActivities({workflows: params.workflows}),
        workflows: [
          // Offset from retention-style top-of-hour sweeps; stale-claim age is
          // governed by AGENT_SESSION_REAP_AFTER_SECONDS.
          {
            name: 'reapStaleSessionClaimsCron',
            id: 'agent-session-reap-stale-claims',
            cronSchedule: '5,15,25,35,45,55 * * * *',
          },
        ],
      },
    ],
  };
}
