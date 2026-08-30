import {annotationsModule} from '@shipfox/annotations';
import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {createAgentModule} from '@shipfox/api-agent';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {createAuthModule} from '@shipfox/api-auth';
import {config as authConfig} from '@shipfox/api-auth/config';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {createDefinitionsModule} from '@shipfox/api-definitions';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {emailChallengesModule} from '@shipfox/api-email-challenges';
import {createIntegrationsContext, type WebhookDeliverySource} from '@shipfox/api-integration-core';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createLogsModule} from '@shipfox/api-logs';
import {createProjectsModule} from '@shipfox/api-projects';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {createRunnersModule} from '@shipfox/api-runners';
import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {createSecretsModule} from '@shipfox/api-secrets';
import {
  type SecretsInterModuleClient,
  secretsInterModuleContract,
} from '@shipfox/api-secrets-dto/inter-module';
import {createTriggersModule} from '@shipfox/api-triggers';
import {createWorkflowsModule} from '@shipfox/api-workflows';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {createWorkspacesModule} from '@shipfox/api-workspaces';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {durationToSeconds} from '@shipfox/node-jwt';
import type {ModuleDatabase, ShipfoxModule} from '@shipfox/node-module';
import {
  createInMemoryInterModuleTransport,
  registerInterModulePresentations,
} from '@shipfox/node-module/inter-module';
import {logger} from '@shipfox/node-opentelemetry';

export interface DefaultModulesOptions {
  webhookDeliverySource?: WebhookDeliverySource | undefined;
  authModule?: DefaultAuthModuleFactory | undefined;
  agentModule?: DefaultAgentModuleFactory | undefined;
  runnersModule?: DefaultRunnersModuleFactory | undefined;
  extension?: DefaultModulesExtension | undefined;
}

export type DefaultAuthModuleFactory = (options: {
  workspaces: WorkspacesInterModuleClient;
}) => ShipfoxModule;

/**
 * Builds the Agent module in the standard composition slot. The default
 * factory validates Agent configuration through `createAgentModule`; a custom
 * factory owns equivalent validation when it does not delegate to that
 * factory. Custom modules must preserve the `agent` database namespace and
 * canonical Agent presentation required by the composed clients.
 */
export type DefaultAgentModuleFactory = (options: {
  secrets: Pick<SecretsInterModuleClient, 'deleteSecrets' | 'getSecretsByNamespace' | 'setSecrets'>;
  /**
   * Optional: the step-attempt-terminated release and the stale-claim reap cron
   * are always registered so composed claim creators get a release backstop;
   * only the job-terminated grace sweep is gated on this client, so a factory
   * built without it stays claim/release-free (as before the session release
   * stack landed).
   */
  workflows?: WorkflowsModuleClient | undefined;
}) => ShipfoxModule;
export type DefaultRunnersModuleFactory = (options: {auth: AuthInterModuleClient}) => ShipfoxModule;
export type DefaultModulesExtension = (options: {
  workspaces: WorkspacesInterModuleClient;
}) => ShipfoxModule[];

export async function defaultModules(
  options: DefaultModulesOptions = {},
): Promise<ShipfoxModule[]> {
  const interModuleTransport = createInMemoryInterModuleTransport({
    reportInternalError: (error, context) => {
      logger().error(
        {err: error, module: context.module, method: context.method, phase: context.phase},
        'Inter-module call failed unexpectedly',
      );
      reportError(error, {
        boundary: 'inter-module',
        operation: `${context.module}.${context.method}`,
        tags: {module: context.module, method: context.method, phase: context.phase},
      });
    },
  });
  const workflowsClient = interModuleTransport.createClient(workflowsInterModuleContract);
  const authClient = interModuleTransport.createClient(authInterModuleContract);
  const agentClient = interModuleTransport.createClient(agentInterModuleContract);
  const runnersClient = interModuleTransport.createClient(runnersInterModuleContract);
  const projectsClient = interModuleTransport.createClient(projectsInterModuleContract);
  const definitionsClient = interModuleTransport.createClient(definitionsInterModuleContract);
  const annotationsClient = interModuleTransport.createClient(annotationsInterModuleContract);
  const secretsClient = interModuleTransport.createClient(secretsInterModuleContract);
  const workspacesClient = interModuleTransport.createClient(workspacesInterModuleContract);
  const integrationsClient = interModuleTransport.createClient(integrationsInterModuleContract);
  const integrations = await createIntegrationsContext({
    workspaces: workspacesClient,
    secrets: {
      deleteSecrets: async (params) => (await secretsClient.deleteSecrets(params)).deleted,
      linear: {
        getSecret: async (params) =>
          (
            await secretsClient.getSecret({
              ...params,
              namespace: `system/integrations/linear/${params.namespace}`,
            })
          ).value,
        setSecrets: async (params) => {
          const {editedBy, ...secretParams} = params;
          await secretsClient.setSecrets({
            ...secretParams,
            namespace: `system/integrations/linear/${secretParams.namespace}`,
            ...(editedBy === undefined ? {} : {editedBy}),
          });
        },
        deleteSecrets: async (params) =>
          (
            await secretsClient.deleteSecrets({
              ...params,
              namespace: `system/integrations/linear/${params.namespace}`,
            })
          ).deleted,
      },
      jira: {
        getSecret: async (params) =>
          (
            await secretsClient.getSecret({
              ...params,
              namespace: `system/integrations/jira/${params.namespace}`,
            })
          ).value,
        setSecrets: async (params) => {
          const {editedBy, ...secretParams} = params;
          await secretsClient.setSecrets({
            ...secretParams,
            namespace: `system/integrations/jira/${secretParams.namespace}`,
            ...(editedBy === undefined ? {} : {editedBy}),
          });
        },
        deleteSecrets: async (params) =>
          (
            await secretsClient.deleteSecrets({
              ...params,
              namespace: `system/integrations/jira/${params.namespace}`,
            })
          ).deleted,
      },
      slack: {
        getSecret: async (params) =>
          (
            await secretsClient.getSecret({
              ...params,
              namespace: `system/integrations/slack/${params.namespace}`,
            })
          ).value,
        setSecrets: async (params) => {
          const {editedBy, ...secretParams} = params;
          await secretsClient.setSecrets({
            ...secretParams,
            namespace: `system/integrations/slack/${secretParams.namespace}`,
            ...(editedBy === undefined ? {} : {editedBy}),
          });
        },
        deleteSecrets: async (params) =>
          (
            await secretsClient.deleteSecrets({
              ...params,
              namespace: `system/integrations/slack/${params.namespace}`,
            })
          ).deleted,
      },
      github: {
        getSecret: async (params) =>
          (
            await secretsClient.getSecret({
              ...params,
              namespace: requireGithubSecretNamespace(params.namespace),
            })
          ).value,
        setSecrets: async (params) => {
          const {editedBy, ...secretParams} = params;
          await secretsClient.setSecrets({
            ...secretParams,
            namespace: requireGithubSecretNamespace(secretParams.namespace),
            ...(editedBy === undefined ? {} : {editedBy}),
          });
        },
        deleteSecrets: async (params) =>
          (
            await secretsClient.deleteSecrets({
              ...params,
              namespace: requireGithubSecretNamespace(params.namespace),
            })
          ).deleted,
      },
    },
    agentTools: {workflows: workflowsClient},
    webhookDeliverySource: options.webhookDeliverySource,
  });
  const projectsModule = createProjectsModule({integrations: integrationsClient, auth: authClient});
  const definitionsModule = createDefinitionsModule({
    projects: projectsClient,
    agent: agentClient,
    integrations: integrationsClient,
  });
  const extensionModules = options.extension?.({workspaces: workspacesClient}) ?? [];
  const agentModule = (options.agentModule ?? createAgentModule)({
    secrets: createAgentSecretsClient(secretsClient),
    workflows: workflowsClient,
  });
  if (options.agentModule) validateCustomAgentModule(agentModule);

  const modules = [
    emailChallengesModule,
    (options.authModule ?? createAuthModule)({workspaces: workspacesClient}),
    createWorkspacesModule({auth: authClient, projects: projectsClient, runners: runnersClient}),
    createSecretsModule(projectsClient),
    agentModule,
    integrations.module,
    projectsModule,
    definitionsModule,
    createWorkflowsModule({
      annotations: annotationsClient,
      agent: agentClient,
      definitions: definitionsClient,
      auth: authClient,
      projects: projectsClient,
      runners: runnersClient,
      secrets: secretsClient,
      workspaces: workspacesClient,
      integrations: integrationsClient,
    }),
    annotationsModule,
    (options.runnersModule ?? createRunnersModule)({auth: authClient}),
    createLogsModule({
      workflows: workflowsClient,
      jobLeaseTokenTtlSeconds: durationToSeconds(authConfig.AUTH_JOB_LEASE_TOKEN_EXPIRES_IN),
    }),
    createTriggersModule({
      workflows: workflowsClient,
      definitions: definitionsClient,
      projects: projectsClient,
    }),
    dispatcherModule,
    ...extensionModules,
  ];
  registerInterModulePresentations({transport: interModuleTransport, modules});
  interModuleTransport.seal();
  return modules;
}

type AgentModuleSecretsClient = Pick<
  SecretsInterModuleClient,
  'deleteSecrets' | 'getSecretsByNamespace' | 'setSecrets'
>;

const GITHUB_SECRET_NAMESPACE_PREFIX = 'system/github/';

function requireGithubSecretNamespace(namespace: string): string {
  if (!namespace.startsWith(GITHUB_SECRET_NAMESPACE_PREFIX)) {
    throw new Error('GitHub secret namespaces must start with system/github/');
  }
  return namespace;
}

function createAgentSecretsClient(
  secretsClient: SecretsInterModuleClient,
): AgentModuleSecretsClient {
  return {
    deleteSecrets: (input, options) => secretsClient.deleteSecrets(input, options),
    getSecretsByNamespace: (input, options) => secretsClient.getSecretsByNamespace(input, options),
    setSecrets: (input, options) => secretsClient.setSecrets(input, options),
  };
}

function validateCustomAgentModule(module: ShipfoxModule): void {
  let databases: ModuleDatabase[] = [];
  if (Array.isArray(module.database)) databases = module.database;
  else if (module.database) databases = [module.database];
  if (
    !databases.some(({databaseNamespace}) => databaseNamespace === agentInterModuleContract.module)
  ) {
    throw new Error(
      'Custom agentModule must declare database namespace "agent" for the Agent module.',
    );
  }

  if (
    !module.interModulePresentations?.some(({contract}) => contract === agentInterModuleContract)
  ) {
    throw new Error('Custom agentModule must present the canonical "agent" inter-module contract.');
  }
}
