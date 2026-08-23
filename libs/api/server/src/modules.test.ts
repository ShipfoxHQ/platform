import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {
  type SecretsInterModuleClient,
  secretsInterModuleContract,
} from '@shipfox/api-secrets-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {defaultModules} from './modules.js';

const mocks = vi.hoisted(() => ({
  buildAgentToolCatalogs: vi.fn(),
  buildAgentToolSelectionCatalogs: vi.fn(),
  createAgentModule: vi.fn(),
  createAuthModule: vi.fn(),
  createDefinitionsModule: vi.fn(),
  createIntegrationsContext: vi.fn(),
  createLogsModule: vi.fn(),
  createProjectsModule: vi.fn(),
  createRunnersModule: vi.fn(),
  createSecretsModule: vi.fn(),
  createTriggersModule: vi.fn(),
  createWorkflowsModule: vi.fn(),
  createWorkspacesModule: vi.fn(),
  createWorkspaceConnectionSnapshotLoader: vi.fn(),
  deleteSecrets: vi.fn(),
  getIntegrationConnectionById: vi.fn(),
  getSecret: vi.fn(),
  getWorkspaceCreator: vi.fn(),
  getWorkspaceOperatingState: vi.fn(),
  listMembershipsForTokenClaims: vi.fn(),
  setSecrets: vi.fn(),
}));

vi.mock('@shipfox/annotations', () => ({
  annotationsModule: {
    name: 'annotations',
    interModulePresentations: [
      {
        contract: annotationsInterModuleContract,
        handlers: {replaceOrRemoveAnnotation: vi.fn()},
      },
    ],
  },
}));
vi.mock('@shipfox/api-auth', () => ({
  createAuthModule: mocks.createAuthModule,
}));
vi.mock('@shipfox/api-agent', () => ({createAgentModule: mocks.createAgentModule}));
vi.mock('@shipfox/api-auth/config', () => ({
  config: {AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: '90m'},
}));
vi.mock('@shipfox/api-definitions', () => ({
  createDefinitionsModule: mocks.createDefinitionsModule,
}));
vi.mock('@shipfox/api-dispatcher', () => ({dispatcherModule: {name: 'dispatcher'}}));
vi.mock('@shipfox/api-email-challenges', () => ({
  emailChallengesModule: {name: 'email-challenges'},
}));
vi.mock('@shipfox/api-integration-core', () => ({
  buildAgentToolCatalogs: mocks.buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs: mocks.buildAgentToolSelectionCatalogs,
  createIntegrationsContext: mocks.createIntegrationsContext,
  createWorkspaceConnectionSnapshotLoader: mocks.createWorkspaceConnectionSnapshotLoader,
  getIntegrationConnectionById: mocks.getIntegrationConnectionById,
}));
vi.mock('@shipfox/api-logs', () => ({createLogsModule: mocks.createLogsModule}));
vi.mock('@shipfox/api-projects', () => ({createProjectsModule: mocks.createProjectsModule}));
vi.mock('@shipfox/api-runners', () => ({createRunnersModule: mocks.createRunnersModule}));
vi.mock('@shipfox/api-secrets', () => ({
  createSecretsModule: mocks.createSecretsModule,
  deleteSecrets: mocks.deleteSecrets,
  getSecret: mocks.getSecret,
  setSecrets: mocks.setSecrets,
}));
vi.mock('@shipfox/api-triggers', () => ({createTriggersModule: mocks.createTriggersModule}));
vi.mock('@shipfox/api-workflows', () => ({
  createWorkflowsModule: mocks.createWorkflowsModule,
}));
vi.mock('@shipfox/api-workspaces', () => ({
  createWorkspacesModule: mocks.createWorkspacesModule,
}));

describe('defaultModules', () => {
  beforeEach(() => {
    mocks.buildAgentToolCatalogs.mockReset();
    mocks.buildAgentToolSelectionCatalogs.mockReset();
    mocks.createAgentModule.mockReset();
    mocks.createAuthModule.mockReset();
    mocks.createDefinitionsModule.mockReset();
    mocks.createIntegrationsContext.mockReset();
    mocks.createLogsModule.mockReset();
    mocks.createProjectsModule.mockReset();
    mocks.createRunnersModule.mockReset();
    mocks.createSecretsModule.mockReset();
    mocks.createTriggersModule.mockReset();
    mocks.createWorkflowsModule.mockReset();
    mocks.createWorkspacesModule.mockReset();
    mocks.createWorkspaceConnectionSnapshotLoader.mockReset();
    mocks.deleteSecrets.mockReset();
    mocks.getIntegrationConnectionById.mockReset();
    mocks.getSecret.mockReset();
    mocks.getWorkspaceCreator.mockReset();
    mocks.listMembershipsForTokenClaims.mockReset();
    mocks.setSecrets.mockReset();

    mocks.createIntegrationsContext.mockResolvedValue({
      module: {
        name: 'integrations',
        interModulePresentations: [
          defineInterModulePresentation(integrationsInterModuleContract, {
            createCheckoutSpec: vi.fn(),
            fetchSourceFile: vi.fn(),
            getAgentToolsContext: vi.fn(),
            listSourceFiles: vi.fn(),
            resolveConnection: vi.fn(),
            resolveSourceRef: vi.fn(),
            resolveSourceRepository: vi.fn(),
            resolveTriggerReference: vi.fn(),
          }),
        ],
      },
      registry: {},
      sourceControl: {provider: 'source-control'},
    });
    mocks.createLogsModule.mockReturnValue({name: 'logs'});
    mocks.buildAgentToolCatalogs.mockResolvedValue(new Map());
    mocks.buildAgentToolSelectionCatalogs.mockResolvedValue(new Map());
    mocks.createWorkspaceConnectionSnapshotLoader.mockReturnValue(vi.fn());
    mocks.createAuthModule.mockReturnValue({
      name: 'auth',
      interModulePresentations: [
        {
          contract: authInterModuleContract,
          handlers: {
            mintJobLeaseToken: vi.fn(),
            mintRunnerSessionToken: vi.fn(),
            getCurrentAdminRole: vi.fn(),
            requireAdminRole: vi.fn(),
          },
        },
      ],
    });
    mocks.deleteSecrets.mockResolvedValue({deleted: 1});
    mocks.getSecret.mockResolvedValue({value: 'secret'});
    mocks.listMembershipsForTokenClaims.mockResolvedValue({memberships: []});
    mocks.getWorkspaceCreator.mockResolvedValue({creatorUserId: null});
    mocks.setSecrets.mockResolvedValue({});
    mocks.createProjectsModule.mockReturnValue({
      name: 'projects',
      interModulePresentations: [
        defineInterModulePresentation(projectsInterModuleContract, {
          getProjectById: () => ({project: null}),
          getProjectBySource: () => ({project: null}),
          listProjectsByWorkspace: () => ({projects: [], nextCursor: null}),
          getWorkspaceProjectCounts: () => ({counts: []}),
          requireProjectForWorkspace: () => ({
            project: {
              id: crypto.randomUUID(),
              workspaceId: crypto.randomUUID(),
              sourceConnectionId: crypto.randomUUID(),
              sourceExternalRepositoryId: 'repo',
              name: 'Project',
            },
          }),
          resolveCheckoutTarget: () => ({
            projectId: crypto.randomUUID(),
            connectionId: crypto.randomUUID(),
            externalRepositoryId: 'repo',
          }),
        }),
      ],
    });
    mocks.createSecretsModule.mockReturnValue({
      name: 'secrets',
      interModulePresentations: [
        defineInterModulePresentation(secretsInterModuleContract, {
          deleteSecrets: mocks.deleteSecrets,
          getSecret: mocks.getSecret,
          getSecretsByNamespace: vi.fn(),
          getVariablesByNamespace: vi.fn(),
          setSecrets: mocks.setSecrets,
        }),
      ],
    });
    mocks.createAgentModule.mockReturnValue({
      name: 'agent',
      interModulePresentations: [
        {
          contract: agentInterModuleContract,
          handlers: {
            getValidationCatalog: vi.fn(),
            resolveAgentConfig: vi.fn(),
            resolveRuntimeCredentials: vi.fn(),
          },
        },
      ],
    });
    mocks.createRunnersModule.mockReturnValue({
      name: 'runners',
      interModulePresentations: [
        {
          contract: runnersInterModuleContract,
          handlers: {
            getEffectiveRunnerToolCapabilities: vi.fn(),
            getWorkspaceJobCounts: vi.fn(),
            getLeaseState: vi.fn(),
          },
        },
      ],
    });
    mocks.createDefinitionsModule.mockReturnValue({
      name: 'definitions',
      interModulePresentations: [
        {
          contract: definitionsInterModuleContract,
          handlers: {
            getDefinitionForWorkflowRun: vi.fn(),
            listDefinitionsAtRef: vi.fn(),
            resolveDefinitionAtRef: vi.fn(),
          },
        },
      ],
    });
    mocks.createWorkflowsModule.mockReturnValue({
      name: 'workflows',
      interModulePresentations: [
        {
          contract: workflowsInterModuleContract,
          handlers: {
            deliverEventToJobListener: vi.fn(),
            getLeasedAgentToolContext: vi.fn(),
            getStepLogContext: vi.fn(),
            resolveWorkflowRunTriggerReference: vi.fn(),
            startRunFromTrigger: vi.fn(),
          },
        },
      ],
    });
    mocks.createTriggersModule.mockReturnValue({name: 'triggers'});
    mocks.createWorkspacesModule.mockReturnValue({
      name: 'workspaces',
      interModulePresentations: [
        {
          contract: workspacesInterModuleContract,
          handlers: {
            listMembershipsForTokenClaims: mocks.listMembershipsForTokenClaims,
            getWorkspaceCreator: mocks.getWorkspaceCreator,
            getWorkspaceOperatingState: mocks.getWorkspaceOperatingState,
            preflightInvitationAcceptance: vi.fn(),
            acceptInvitation: vi.fn(),
            requireActiveMembership: vi.fn(),
          },
        },
      ],
    });
  });

  it('returns the API modules in lifecycle order', async () => {
    const modules = await defaultModules();

    expect(modules.map((module) => module.name)).toEqual([
      'email-challenges',
      'auth',
      'workspaces',
      'secrets',
      'agent',
      'integrations',
      'projects',
      'definitions',
      'workflows',
      'annotations',
      'runners',
      'logs',
      'triggers',
      'dispatcher',
    ]);
  });

  it('registers one presentation for every composed inter-module client before sealing', async () => {
    const modules = await defaultModules();
    const presentationModules = modules.flatMap((module) =>
      (module.interModulePresentations ?? []).map(({contract}) => contract.module),
    );
    const composedClientModules = [
      agentInterModuleContract,
      annotationsInterModuleContract,
      authInterModuleContract,
      definitionsInterModuleContract,
      integrationsInterModuleContract,
      projectsInterModuleContract,
      runnersInterModuleContract,
      secretsInterModuleContract,
      workflowsInterModuleContract,
      workspacesInterModuleContract,
    ].map((contract) => contract.module);

    expect(presentationModules.sort()).toEqual(composedClientModules.sort());
  });

  it('injects Auth into the Runners module', async () => {
    await defaultModules();

    expect(mocks.createRunnersModule).toHaveBeenCalledWith({auth: expect.any(Object)});
  });

  it('uses the default Auth module factory when none is supplied', async () => {
    await defaultModules();

    expect(mocks.createAuthModule).toHaveBeenCalledWith({workspaces: expect.any(Object)});
  });

  it('composes Auth with the shared Workspaces client and registers the supplied module', async () => {
    const signupPolicy = {isSignupAllowed: vi.fn().mockResolvedValue({allowed: true})};
    const customAuthModule = mocks.createAuthModule();
    mocks.createAuthModule.mockClear();
    let extensionWorkspaces: WorkspacesInterModuleClient | undefined;
    const extension = vi.fn(({workspaces}: {workspaces: WorkspacesInterModuleClient}) => {
      extensionWorkspaces = workspaces;
      return [];
    });
    const authModule = vi.fn(({workspaces}: {workspaces: WorkspacesInterModuleClient}) =>
      mocks.createAuthModule({workspaces, signupPolicy}),
    );

    const modules = await defaultModules({authModule, extension});
    const authWorkspaces = authModule.mock.calls[0]?.[0].workspaces;

    expect(authModule).toHaveBeenCalledWith({workspaces: expect.any(Object)});
    expect(mocks.createAuthModule).toHaveBeenCalledWith({
      workspaces: authWorkspaces,
      signupPolicy,
    });
    expect(extension).toHaveBeenCalledWith({workspaces: authWorkspaces});
    expect(extensionWorkspaces).toBe(authWorkspaces);
    expect(modules).toContain(customAuthModule);
    expect(
      modules.flatMap((module) =>
        (module.interModulePresentations ?? []).map(({contract}) => contract.module),
      ),
    ).toContain(authInterModuleContract.module);
  });

  it('lets a host replace only the Runners module with the composed Auth client', async () => {
    const policy = {filterEligibleWorkspaceIds: vi.fn().mockResolvedValue(new Set<string>())};
    const runnersModule = mocks.createRunnersModule({});
    const createHostRunnersModule = vi.fn(({auth}) =>
      mocks.createRunnersModule({auth, installationProvisioning: {policy}}),
    );
    mocks.createRunnersModule.mockClear();

    const modules = await defaultModules({runnersModule: createHostRunnersModule});

    expect(createHostRunnersModule).toHaveBeenCalledWith({auth: expect.any(Object)});
    expect(mocks.createRunnersModule).toHaveBeenCalledWith({
      auth: createHostRunnersModule.mock.calls[0]?.[0].auth,
      installationProvisioning: {policy},
    });
    expect(modules.filter((module) => module.name === 'runners')).toEqual([runnersModule]);
    expect(modules.map((module) => module.name)).toEqual([
      'email-challenges',
      'auth',
      'workspaces',
      'secrets',
      'agent',
      'integrations',
      'projects',
      'definitions',
      'workflows',
      'annotations',
      'runners',
      'logs',
      'triggers',
      'dispatcher',
    ]);
  });

  it('extends the default module list with the composed Workspaces client', async () => {
    let workspaces: WorkspacesInterModuleClient | undefined;
    const extensionModule = {name: 'cloud'};
    const extension = vi.fn((options: {workspaces: WorkspacesInterModuleClient}) => {
      workspaces = options.workspaces;
      return [extensionModule];
    });

    const modules = await defaultModules({extension});
    const userId = crypto.randomUUID();
    const memberships = await workspaces?.listMembershipsForTokenClaims({userId});
    const workspaceId = crypto.randomUUID();
    const creator = await workspaces?.getWorkspaceCreator({workspaceId});

    expect(extension).toHaveBeenCalledWith({workspaces: expect.any(Object)});
    expect(memberships).toEqual({memberships: []});
    expect(creator).toEqual({creatorUserId: null});
    expect(mocks.listMembershipsForTokenClaims).toHaveBeenCalledWith(
      {userId},
      expect.objectContaining({signal: expect.any(AbortSignal)}),
    );
    expect(mocks.getWorkspaceCreator).toHaveBeenCalledWith(
      {workspaceId},
      expect.objectContaining({signal: expect.any(AbortSignal)}),
    );
    expect(modules.at(-1)).toBe(extensionModule);
  });

  it('injects Workflows into integrations and logs and namespaces provider secrets', async () => {
    await defaultModules();

    expect(mocks.createIntegrationsContext).toHaveBeenCalledWith({
      workspaces: expect.anything(),
      secrets: {
        deleteSecrets: expect.any(Function),
        linear: {
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          setSecrets: expect.any(Function),
        },
        jira: {
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          setSecrets: expect.any(Function),
        },
        slack: {
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          setSecrets: expect.any(Function),
        },
      },
      agentTools: {workflows: expect.objectContaining({getStepLogContext: expect.any(Function)})},
      webhookDeliverySource: undefined,
    });

    const integrationsOptions = mocks.createIntegrationsContext.mock.calls[0]?.[0] as {
      secrets: {
        linear: Pick<SecretsInterModuleClient, 'deleteSecrets' | 'getSecret' | 'setSecrets'>;
        jira: Pick<SecretsInterModuleClient, 'deleteSecrets' | 'getSecret' | 'setSecrets'>;
        slack: Pick<SecretsInterModuleClient, 'deleteSecrets' | 'getSecret' | 'setSecrets'>;
      };
      agentTools: {workflows: unknown};
    };
    expect(integrationsOptions.agentTools.workflows).toEqual(
      expect.objectContaining({getLeasedAgentToolContext: expect.any(Function)}),
    );
    expect(mocks.createLogsModule).toHaveBeenCalledWith({
      workflows: expect.objectContaining({getStepLogContext: expect.any(Function)}),
      jobLeaseTokenTtlSeconds: 5400,
    });

    const scope = {workspaceId: crypto.randomUUID(), projectId: null, namespace: 'workspace'};
    await Promise.all([
      integrationsOptions.secrets.linear.getSecret({...scope, key: 'token'}),
      integrationsOptions.secrets.linear.setSecrets({
        ...scope,
        values: {token: 'secret'},
        editedBy: undefined,
      }),
      integrationsOptions.secrets.linear.deleteSecrets({...scope, keys: ['token']}),
      integrationsOptions.secrets.jira.getSecret({...scope, key: 'token'}),
      integrationsOptions.secrets.jira.setSecrets({
        ...scope,
        values: {token: 'secret'},
        editedBy: undefined,
      }),
      integrationsOptions.secrets.jira.deleteSecrets({...scope, keys: ['token']}),
      integrationsOptions.secrets.slack.getSecret({...scope, key: 'token'}),
      integrationsOptions.secrets.slack.setSecrets({
        ...scope,
        values: {token: 'secret'},
        editedBy: undefined,
      }),
      integrationsOptions.secrets.slack.deleteSecrets({...scope, keys: ['token']}),
    ]);

    expect(mocks.getSecret.mock.calls.map(([params]) => params)).toContainEqual({
      key: 'token',
      namespace: 'system/integrations/linear/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.setSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      values: {token: 'secret'},
      namespace: 'system/integrations/linear/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.deleteSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      keys: ['token'],
      namespace: 'system/integrations/linear/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.getSecret.mock.calls.map(([params]) => params)).toContainEqual({
      key: 'token',
      namespace: 'system/integrations/jira/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.setSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      values: {token: 'secret'},
      namespace: 'system/integrations/jira/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.deleteSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      keys: ['token'],
      namespace: 'system/integrations/jira/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.getSecret.mock.calls.map(([params]) => params)).toContainEqual({
      key: 'token',
      namespace: 'system/integrations/slack/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.setSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      values: {token: 'secret'},
      namespace: 'system/integrations/slack/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.deleteSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      keys: ['token'],
      namespace: 'system/integrations/slack/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
  });

  it('passes an optional webhook delivery source to integration composition', async () => {
    const webhookDeliverySource = {createService: vi.fn()};

    await defaultModules({webhookDeliverySource});

    expect(mocks.createIntegrationsContext).toHaveBeenCalledWith(
      expect.objectContaining({webhookDeliverySource}),
    );
  });
});
