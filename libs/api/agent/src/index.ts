import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {
  assertAgentConfig,
  warnOnUnsafeAgentSessionConfig,
  workspaceProvidersPolicy,
} from '#config.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {db, migrationsPath} from '#db/index.js';
import {createAgentE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createAgentInterModulePresentation} from '#presentation/inter-module.js';
import {createAgentRoutes} from '#presentation/routes/index.js';
import {onJobTerminated} from '#presentation/subscribers/on-job-terminated.js';
import {onStepAttemptTerminated} from '#presentation/subscribers/on-step-attempt-terminated.js';
import {onWorkflowRunTerminated} from '#presentation/subscribers/on-workflow-run-terminated.js';
import {createAgentSessionActivities} from '#temporal/activities/index.js';
import {AGENT_SESSION_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

export {
  type AgentConfigResolutionContext,
  type AgentDefaultsResolver,
  AgentSessionKekVersionStrandedError,
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
  rotateAgentSessionDataKeys,
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
  /**
   * Workflows-facing release seam. The step-attempt-terminated release and the
   * stale-claim reap cron are always registered so any composed consumer that
   * creates claims gets a release backstop; only the job-terminated grace sweep
   * (which lists the job's step attempts through this client) is gated on it,
   * so an external consumer can omit it and keep the module claim/release-free.
   */
  workflows?: WorkflowsModuleClient | undefined;
}): ShipfoxModule {
  assertAgentConfig(params.managedProvider);
  warnOnUnsafeAgentSessionConfig();

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
    // the step-attempt-terminated event and a stale-claim reap cron as the last
    // safety net. Both are registered independently of the workflows client so
    // a consumer that composes workflows (and can therefore create claims) gets
    // a release backstop even when it builds the agent module through a custom
    // factory that does not forward the client. Only the job-terminated grace
    // sweep needs the workflows client (it lists the job's step attempts), so
    // that subscriber is gated on the optional argument.
    subscribers: [
      subscriber(WORKFLOWS_STEP_ATTEMPT_TERMINATED, onStepAttemptTerminated),
      subscriber(WORKFLOWS_WORKFLOW_RUN_TERMINATED, onWorkflowRunTerminated),
      ...(params.workflows === undefined
        ? []
        : [subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated)]),
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
          // Offset from the logs retention cron's top-of-hour sweep.
          {
            name: 'sessionRetentionSweepCron',
            id: 'agent-session-retention-sweep',
            cronSchedule: '30 * * * *',
          },
        ],
      },
    ],
  };
}
