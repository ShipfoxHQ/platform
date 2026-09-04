import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {
  type SecretsInterModuleClient,
  secretsInterModuleContract,
} from '@shipfox/api-secrets-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {usageInterModuleContract} from '@shipfox/api-usage-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {defineInterModuleContract, defineInterModulePresentation} from '@shipfox/inter-module';
import type {
  DefaultAgentModuleFactory,
  DefaultAgentModuleOptions,
  DefaultModulesOptions,
  DefaultWorkflowsModuleOptions,
} from './modules.js';
import {defaultModules} from './modules.js';

const mocks = vi.hoisted(() => ({
  buildAgentToolCatalogs: vi.fn(),
  buildAgentToolSelectionCatalogs: vi.fn(),
  createAgentModule: vi.fn(),
  createAgentAccessModule: vi.fn(),
  createAuthModule: vi.fn(),
  createDefinitionsModule: vi.fn(),
  createIntegrationsContext: vi.fn(),
  createLogsModule: vi.fn(),
  createProjectsModule: vi.fn(),
  createRunnersModule: vi.fn(),
  createSecretsModule: vi.fn(),
  createTriggersModule: vi.fn(),
  createUsageModule: vi.fn(),
  createWorkflowsModule: vi.fn(),
  createWorkspacesModule: vi.fn(),
  createWorkspaceConnectionSnapshotLoader: vi.fn(),
  deleteSecrets: vi.fn(),
  getIntegrationConnectionById: vi.fn(),
  getSecret: vi.fn(),
  getSecretsByNamespace: vi.fn(),
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
        handlers: {
          listAnnotationsForRunAttempt: vi.fn(),
          replaceOrRemoveAnnotation: vi.fn(),
        },
      },
    ],
  },
}));
vi.mock('@shipfox/api-auth', () => ({
  createAuthModule: mocks.createAuthModule,
}));
vi.mock('@shipfox/api-agent', () => ({createAgentModule: mocks.createAgentModule}));
vi.mock('@shipfox/api-agent-access', () => ({
  createAgentAccessModule: mocks.createAgentAccessModule,
}));
vi.mock('@shipfox/api-auth/config', () => ({
  config: {API_PUBLIC_URL: 'https://api.example.test', AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: '90m'},
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
vi.mock('@shipfox/api-usage', () => ({createUsageModule: mocks.createUsageModule}));
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
    mocks.createAgentAccessModule.mockReset();
    mocks.createAuthModule.mockReset();
    mocks.createDefinitionsModule.mockReset();
    mocks.createIntegrationsContext.mockReset();
    mocks.createLogsModule.mockReset();
    mocks.createProjectsModule.mockReset();
    mocks.createRunnersModule.mockReset();
    mocks.createSecretsModule.mockReset();
    mocks.createTriggersModule.mockReset();
    mocks.createUsageModule.mockReset();
    mocks.createWorkflowsModule.mockReset();
    mocks.createWorkspacesModule.mockReset();
    mocks.createWorkspaceConnectionSnapshotLoader.mockReset();
    mocks.deleteSecrets.mockReset();
    mocks.getIntegrationConnectionById.mockReset();
    mocks.getSecret.mockReset();
    mocks.getSecretsByNamespace.mockReset();
    mocks.getWorkspaceCreator.mockReset();
    mocks.listMembershipsForTokenClaims.mockReset();
    mocks.setSecrets.mockReset();

    mocks.createIntegrationsContext.mockResolvedValue({
      module: {
        name: 'integrations',
        interModulePresentations: [
          defineInterModulePresentation(integrationsInterModuleContract, {
            callTool: vi.fn(),
            createCheckoutCredentials: vi.fn(),
            createCheckoutSpec: vi.fn(),
            fetchSourceFile: vi.fn(),
            getAgentToolsContext: vi.fn(),
            listSourceFiles: vi.fn(),
            resolveConnection: vi.fn(),
            resolveConnectionById: vi.fn(),
            resolveSourceRef: vi.fn(),
            resolveSourceRepository: vi.fn(),
            resolveTriggerReference: vi.fn(),
          }),
        ],
      },
      registry: {},
      sourceControl: {provider: 'source-control'},
    });
    const logsInterModuleHandlers = {
      readStepLogTail: vi.fn(),
      appendServerRecords: vi.fn(),
    };
    mocks.createLogsModule.mockReturnValue({
      name: 'logs',
      interModulePresentations: [
        defineInterModulePresentation(logsInterModuleContract, logsInterModuleHandlers),
      ],
    });
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
    mocks.getSecretsByNamespace.mockResolvedValue({values: {}});
    mocks.listMembershipsForTokenClaims.mockResolvedValue({memberships: []});
    mocks.getWorkspaceCreator.mockResolvedValue({creatorUserId: null});
    mocks.setSecrets.mockResolvedValue({});
    mocks.createProjectsModule.mockReturnValue({
      name: 'projects',
      interModulePresentations: [
        defineInterModulePresentation(projectsInterModuleContract, {
          getProjectById: () => ({project: null}),
          getProjectBySource: () => ({project: null}),
          findProjectBySourceRepositoryName: () => ({projects: []}),
          listProjectsBySourceConnection: () => ({projects: [], nextCursor: null}),
          listProjectsByWorkspace: () => ({projects: [], nextCursor: null}),
          listProjectCatalogByWorkspace: () => ({projects: [], nextCursor: null}),
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
            target: {kind: 'external-id' as const, externalRepositoryId: 'repo'},
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
          getSecretsByNamespace: mocks.getSecretsByNamespace,
          getVariablesByNamespace: vi.fn(),
          setSecrets: mocks.setSecrets,
        }),
      ],
    });
    mocks.createAgentModule.mockReturnValue({
      name: 'agent',
      database: {db: () => undefined as never, migrationsPath: 'test', databaseNamespace: 'agent'},
      interModulePresentations: [
        {
          contract: agentInterModuleContract,
          handlers: {
            getValidationCatalog: vi.fn(),
            getValidationCatalogV2: vi.fn(),
            resolveAgentConfig: vi.fn(),
            resolveRuntimeCredentials: vi.fn(),
            claimSession: vi.fn(),
            releaseSession: vi.fn(),
            carryOverSessions: vi.fn(),
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
            listDefinitionsByProject: vi.fn(),
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
            listWorkflowRuns: vi.fn(),
            getWorkflowRunOverview: vi.fn(),
            listWorkflowRunAttempts: vi.fn(),
            listWorkflowRunJobs: vi.fn(),
            getWorkflowJobDetail: vi.fn(),
            listWorkflowJobExecutions: vi.fn(),
            listWorkflowExecutionSteps: vi.fn(),
            listWorkflowStepAttempts: vi.fn(),
            getWorkflowRunSource: vi.fn(),
            getWorkflowJobExecutionContext: vi.fn(),
            listExecutionTriggerEvents: vi.fn(),
            getExecutionTriggerEvent: vi.fn(),
            getWorkflowStepAttemptDetail: vi.fn(),
            listWorkflowRunAnnotations: vi.fn(),
            listWorkflowRunJobExplanations: vi.fn(),
            listFailedStepAttempts: vi.fn(),
            getStepAttemptDetail: vi.fn(),
            getLatestRunAttempt: vi.fn(),
            getLatestStepAttempt: vi.fn(),
            getLeasedAgentSessionContext: vi.fn(),
            getLeasedAgentToolContext: vi.fn(),
            getStepLogContext: vi.fn(),
            listJobStepAttempts: vi.fn(),
            resolveWorkflowRunTriggerReference: vi.fn(),
            startDevRun: vi.fn(),
            startRunFromTrigger: vi.fn(),
          },
        },
      ],
    });
    mocks.createAgentAccessModule.mockReturnValue({name: 'agent-access'});
    mocks.createTriggersModule.mockReturnValue({
      name: 'triggers',
      interModulePresentations: [
        defineInterModulePresentation(triggersInterModuleContract, {
          listTriggerEvents: vi.fn(),
          getTriggerEvent: vi.fn(),
          getTriggerEventFacets: vi.fn(),
        }),
      ],
    });
    mocks.createUsageModule.mockReturnValue({
      name: 'usage',
      interModulePresentations: [
        {
          contract: usageInterModuleContract,
          handlers: {
            recordInferenceSegments: vi.fn(),
            listJobExecutionUsage: vi.fn(),
            listInferenceSegments: vi.fn(),
          },
        },
      ],
    });
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
      'agent-access',
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
      'usage',
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
      logsInterModuleContract,
      projectsInterModuleContract,
      runnersInterModuleContract,
      secretsInterModuleContract,
      triggersInterModuleContract,
      usageInterModuleContract,
      workflowsInterModuleContract,
      workspacesInterModuleContract,
    ].map((contract) => contract.module);

    expect(presentationModules.sort()).toEqual(composedClientModules.sort());
  });

  it('injects Auth into the Runners module', async () => {
    await defaultModules();

    expect(mocks.createRunnersModule).toHaveBeenCalledWith({auth: expect.any(Object)});
  });

  it('composes Agent Access with every producer client and the public API URL', async () => {
    await defaultModules();

    expect(mocks.createAgentAccessModule).toHaveBeenCalledWith({
      annotations: expect.any(Object),
      apiPublicUrl: 'https://api.example.test',
      definitions: expect.any(Object),
      logs: expect.any(Object),
      projects: expect.any(Object),
      triggers: expect.any(Object),
      workflows: expect.any(Object),
    });
  });

  it('uses the default Auth module factory when none is supplied', async () => {
    await defaultModules();

    expect(mocks.createAuthModule).toHaveBeenCalledWith({workspaces: expect.any(Object)});
  });

  it('uses the default Agent module factory when none is supplied', async () => {
    await defaultModules();

    expect(mocks.createAgentModule).toHaveBeenCalledWith({
      secrets: expect.any(Object),
      workflows: expect.any(Object),
    });
    expect(mocks.createAgentModule.mock.calls[0]?.[0].secrets).not.toHaveProperty('getSecret');
  });

  it('composes Agent options with the default factory and keeps session routes registered', async () => {
    const managedProvider: NonNullable<DefaultAgentModuleOptions['managedProvider']> = {
      id: 'managed',
      label: 'Managed',
      models: [],
      defaultModel: 'managed-model',
      resolveCredentials: async () => ({
        api: 'openai-responses',
        baseUrl: 'https://gateway.example.test',
        credentials: {},
      }),
    };
    const sessionTranscriptRoutes = [
      {prefix: '/runs/jobs/current/steps/:stepId/session', routes: []},
    ];
    const defaultAgentModule = mocks.createAgentModule();
    mocks.createAgentModule.mockClear();
    mocks.createAgentModule.mockImplementation(({workflows}) => ({
      ...defaultAgentModule,
      routes: workflows === undefined ? [] : sessionTranscriptRoutes,
    }));

    const modules = await defaultModules({agentModuleOptions: {managedProvider}});
    const agentOptions = mocks.createAgentModule.mock.calls[0]?.[0];

    expect(agentOptions).toEqual({
      managedProvider,
      secrets: expect.any(Object),
      workflows: expect.objectContaining({
        getLeasedAgentSessionContext: expect.any(Function),
      }),
    });
    expect(modules.find((module) => module.name === 'agent')?.routes).toBe(sessionTranscriptRoutes);
  });

  it('keeps composition-owned Agent dependencies ahead of runtime options', async () => {
    const hostSecrets = {getSecret: vi.fn()};
    const hostWorkflows = {getLeasedAgentSessionContext: vi.fn()};
    const agentModuleOptions = {
      secrets: hostSecrets,
      workflows: hostWorkflows,
    } as unknown as DefaultAgentModuleOptions;

    await defaultModules({agentModuleOptions});

    const agentOptions = mocks.createAgentModule.mock.calls[0]?.[0] as
      | {secrets: object; workflows: object}
      | undefined;
    expect(agentOptions).toBeDefined();
    if (!agentOptions) throw new Error('Default Agent module options were not captured.');
    expect(agentOptions.secrets).not.toBe(hostSecrets);
    expect(agentOptions.secrets).not.toHaveProperty('getSecret');
    expect(agentOptions.workflows).not.toBe(hostWorkflows);
    expect(agentOptions.workflows).toEqual(
      expect.objectContaining({getLeasedAgentSessionContext: expect.any(Function)}),
    );
  });

  it('supports an explicitly named full Agent module replacement', async () => {
    const customAgentModule = mocks.createAgentModule();
    mocks.createAgentModule.mockClear();
    const agentModule = vi.fn<DefaultAgentModuleFactory>((options) =>
      mocks.createAgentModule(options),
    );

    const modules = await defaultModules({agentModuleFactory: agentModule});
    const agentFactoryCall = agentModule.mock.calls[0];
    expect(agentFactoryCall).toBeDefined();
    if (!agentFactoryCall) throw new Error('Agent module factory was not called.');
    const agentSecrets = agentFactoryCall[0].secrets;
    const scope = {
      workspaceId: crypto.randomUUID(),
      projectId: null,
      namespace: 'agent',
    };
    const secretValues = await agentSecrets.getSecretsByNamespace(scope);

    expect(agentModule).toHaveBeenCalledWith({
      secrets: expect.any(Object),
      workflows: expect.any(Object),
    });
    expect(secretValues).toEqual({values: {}});
    expect(mocks.getSecretsByNamespace).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({signal: expect.any(AbortSignal)}),
    );
    expect(agentSecrets).not.toHaveProperty('getSecret');
    expect(agentSecrets).not.toHaveProperty('getVariablesByNamespace');
    expect(mocks.createAgentModule).toHaveBeenCalledWith({
      secrets: agentSecrets,
      workflows: expect.any(Object),
    });
    expect(mocks.createAgentModule).toHaveBeenCalledTimes(1);
    expect(modules.filter((module) => module.name === 'agent')).toEqual([customAgentModule]);
    expect(
      modules
        .flatMap((module) =>
          (module.interModulePresentations ?? []).map(({contract}) => contract.module),
        )
        .filter((module) => module === agentInterModuleContract.module),
    ).toEqual([agentInterModuleContract.module]);
    expect(modules.map((module) => module.name)).toEqual([
      'email-challenges',
      'auth',
      'agent-access',
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
      'usage',
      'triggers',
      'dispatcher',
    ]);
  });

  it('rejects a custom Agent module without the Agent database namespace', async () => {
    const customAgentModule = {
      ...mocks.createAgentModule(),
      database: {
        db: () => undefined as never,
        migrationsPath: 'test',
        databaseNamespace: 'custom_agent',
      },
    };

    await expect(defaultModules({agentModuleFactory: () => customAgentModule})).rejects.toThrow(
      'Custom agentModule must declare database namespace "agent"',
    );
  });

  it('rejects a custom Agent module without the canonical Agent presentation', async () => {
    const customAgentModule = {
      ...mocks.createAgentModule(),
      interModulePresentations: [],
    };

    await expect(defaultModules({agentModuleFactory: () => customAgentModule})).rejects.toThrow(
      'Custom agentModule must present the canonical "agent" inter-module contract',
    );
  });

  it('rejects a custom Agent module with a mismatched Agent contract', async () => {
    const defaultAgentModule = mocks.createAgentModule();
    const defaultPresentation = defaultAgentModule.interModulePresentations?.[0];
    if (!defaultPresentation) throw new Error('Default Agent presentation is not configured.');
    const mismatchedAgentContract = defineInterModuleContract({
      module: agentInterModuleContract.module,
      methods: Object.fromEntries(
        Object.entries(agentInterModuleContract.methods).map(([method, contract]) => [
          method,
          {input: contract.input, output: contract.output, errors: contract.errors},
        ]),
      ),
    });
    const customAgentModule = {
      ...defaultAgentModule,
      interModulePresentations: [{...defaultPresentation, contract: mismatchedAgentContract}],
    };

    await expect(defaultModules({agentModuleFactory: () => customAgentModule})).rejects.toThrow(
      'Custom agentModule must present the canonical "agent" inter-module contract',
    );
  });

  it('rejects conflicting module customization paths before creating a module', async () => {
    const managedProvider: NonNullable<DefaultAgentModuleOptions['managedProvider']> = {
      id: 'managed',
      label: 'Managed',
      models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
      defaultModel: 'managed-model',
      resolveCredentials: async () => ({
        api: 'openai-responses',
        baseUrl: 'https://gateway.example.test',
        credentials: {},
      }),
    };
    const signupPolicy = {isSignupAllowed: vi.fn().mockResolvedValue({allowed: true})};
    const installationProvisioning = {
      policy: {
        filterEligibleWorkspaceIds: async (workspaceIds: readonly string[]) =>
          new Set(workspaceIds),
      },
    };
    const replacementFactory = () => ({name: 'replacement'});
    const cases = [
      {
        moduleName: 'Agent',
        article: 'an',
        moduleMock: mocks.createAgentModule,
        moduleOptions: {agentModuleOptions: {managedProvider}},
        newFactory: {agentModuleFactory: replacementFactory},
        legacyFactory: {agentModule: replacementFactory},
      },
      {
        moduleName: 'Auth',
        article: 'an',
        moduleMock: mocks.createAuthModule,
        moduleOptions: {authModuleOptions: {signupPolicy}},
        newFactory: {authModuleFactory: replacementFactory},
        legacyFactory: {authModule: replacementFactory},
      },
      {
        moduleName: 'Runners',
        article: 'a',
        moduleMock: mocks.createRunnersModule,
        moduleOptions: {runnersModuleOptions: {installationProvisioning}},
        newFactory: {runnersModuleFactory: replacementFactory},
        legacyFactory: {runnersModule: replacementFactory},
      },
    ] as const;

    for (const {
      moduleName,
      article,
      moduleMock,
      moduleOptions,
      newFactory,
      legacyFactory,
    } of cases) {
      for (const [description, conflict] of [
        ['options with named replacement', {...moduleOptions, ...newFactory}],
        ['options with legacy replacement', {...moduleOptions, ...legacyFactory}],
      ] as const) {
        moduleMock.mockClear();
        await expect(defaultModules(conflict as DefaultModulesOptions)).rejects.toThrow(
          `Use ${moduleName} module options or ${article} ${moduleName} module replacement factory, not both.`,
        );
        expect(moduleMock, `${moduleName} ${description}`).not.toHaveBeenCalled();
      }

      moduleMock.mockClear();
      await expect(
        defaultModules({...newFactory, ...legacyFactory} as DefaultModulesOptions),
      ).rejects.toThrow(`Provide only one ${moduleName} module replacement factory.`);
      expect(moduleMock, `${moduleName} replacement conflict`).not.toHaveBeenCalled();
    }
  });

  it('treats module options with no defined values as unconfigured', async () => {
    const customAgentModule = mocks.createAgentModule();
    mocks.createAgentModule.mockClear();
    const agentModuleFactory = vi.fn(() => customAgentModule);

    await defaultModules({
      agentModuleOptions: {managedProvider: undefined},
      agentModuleFactory,
    });

    expect(agentModuleFactory).toHaveBeenCalledWith({
      secrets: expect.any(Object),
      workflows: expect.any(Object),
    });
    expect(mocks.createAgentModule).not.toHaveBeenCalled();
  });

  it('keeps legacy module replacement aliases working during migration', async () => {
    const customAgentModule = mocks.createAgentModule();
    const customAuthModule = mocks.createAuthModule();
    const customRunnersModule = mocks.createRunnersModule();
    mocks.createAgentModule.mockClear();
    mocks.createAuthModule.mockClear();
    mocks.createRunnersModule.mockClear();

    const modules = await defaultModules({
      agentModule: () => customAgentModule,
      authModule: () => customAuthModule,
      runnersModule: () => customRunnersModule,
    });

    expect(modules).toEqual(
      expect.arrayContaining([customAgentModule, customAuthModule, customRunnersModule]),
    );
  });

  it('rejects an extension that duplicates the Agent presentation', async () => {
    const defaultAgentModule = mocks.createAgentModule();
    const agentPresentation = defaultAgentModule.interModulePresentations?.[0];
    if (!agentPresentation) throw new Error('Default Agent presentation is not configured.');

    await expect(
      defaultModules({
        extension: () => [{name: 'duplicate-agent', interModulePresentations: [agentPresentation]}],
      }),
    ).rejects.toThrow('Module "agent" already has a registered presentation');
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

    const modules = await defaultModules({authModuleFactory: authModule, extension});
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

  it('composes Auth options with the shared Workspaces client', async () => {
    const signupPolicy = {isSignupAllowed: vi.fn().mockResolvedValue({allowed: true})};

    await defaultModules({authModuleOptions: {signupPolicy}});

    expect(mocks.createAuthModule).toHaveBeenCalledWith({
      signupPolicy,
      workspaces: expect.any(Object),
    });
  });

  it('supports an explicitly named full Runners module replacement', async () => {
    const policy = {filterEligibleWorkspaceIds: vi.fn().mockResolvedValue(new Set<string>())};
    const runnersModule = mocks.createRunnersModule({});
    const createHostRunnersModule = vi.fn(({auth}) =>
      mocks.createRunnersModule({auth, installationProvisioning: {policy}}),
    );
    mocks.createRunnersModule.mockClear();

    const modules = await defaultModules({runnersModuleFactory: createHostRunnersModule});

    expect(createHostRunnersModule).toHaveBeenCalledWith({auth: expect.any(Object)});
    expect(mocks.createRunnersModule).toHaveBeenCalledWith({
      auth: createHostRunnersModule.mock.calls[0]?.[0].auth,
      installationProvisioning: {policy},
    });
    expect(modules.filter((module) => module.name === 'runners')).toEqual([runnersModule]);
    expect(modules.map((module) => module.name)).toEqual([
      'email-challenges',
      'auth',
      'agent-access',
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
      'usage',
      'triggers',
      'dispatcher',
    ]);
  });

  it('composes Runners options with the shared Auth client', async () => {
    const policy = {filterEligibleWorkspaceIds: vi.fn().mockResolvedValue(new Set<string>())};

    await defaultModules({
      runnersModuleOptions: {installationProvisioning: {policy}},
    });

    expect(mocks.createRunnersModule).toHaveBeenCalledWith({
      auth: expect.any(Object),
      installationProvisioning: {policy},
    });
  });

  it('composes Workflows admission options', async () => {
    const policy = {admit: vi.fn().mockResolvedValue({allowed: true})};
    const options: DefaultWorkflowsModuleOptions = {admission: {policy}};

    await defaultModules({workflowsModuleOptions: options});

    expect(mocks.createWorkflowsModule).toHaveBeenCalledWith(
      expect.objectContaining({admission: {policy}}),
    );
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
        github: {
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          getSecretsByNamespace: expect.any(Function),
          setSecrets: expect.any(Function),
        },
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
      projects: expect.objectContaining({
        getProjectBySource: expect.any(Function),
        findProjectBySourceRepositoryName: expect.any(Function),
      }),
      webhookDeliverySource: undefined,
    });

    const integrationsOptions = mocks.createIntegrationsContext.mock.calls[0]?.[0] as {
      secrets: {
        github: Pick<
          SecretsInterModuleClient,
          'deleteSecrets' | 'getSecret' | 'getSecretsByNamespace' | 'setSecrets'
        >;
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

    const scope = {
      workspaceId: crypto.randomUUID(),
      projectId: null,
      namespace: 'workspace',
    };
    const githubScope = {
      workspaceId: scope.workspaceId,
      projectId: null,
      namespace: 'system/github/installation-token/1',
    };
    const githubSecret = await integrationsOptions.secrets.github.getSecret({
      ...githubScope,
      key: 'token',
    });
    const githubSecrets = await integrationsOptions.secrets.github.getSecretsByNamespace({
      ...githubScope,
    });
    const githubDeleted = await integrationsOptions.secrets.github.deleteSecrets({
      ...githubScope,
      keys: ['token'],
    });

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
      integrationsOptions.secrets.github.setSecrets({
        ...githubScope,
        values: {token: 'secret'},
        editedBy: undefined,
      }),
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
    expect(githubSecret).toBe('secret');
    expect(githubSecrets).toEqual({});
    expect(githubDeleted).toBe(1);
    expect(mocks.getSecret.mock.calls.map(([params]) => params)).toContainEqual({
      key: 'token',
      namespace: githubScope.namespace,
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.getSecretsByNamespace.mock.calls.map(([params]) => params)).toContainEqual({
      namespace: githubScope.namespace,
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.deleteSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      keys: ['token'],
      namespace: githubScope.namespace,
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    const editedBy = crypto.randomUUID();
    await integrationsOptions.secrets.github.setSecrets({
      ...githubScope,
      values: {token: 'secret'},
      editedBy,
    });
    expect(mocks.setSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      values: {token: 'secret'},
      namespace: githubScope.namespace,
      workspaceId: scope.workspaceId,
      projectId: null,
      editedBy,
    });
    await expect(
      integrationsOptions.secrets.github.getSecret({...scope, key: 'token'}),
    ).rejects.toThrow('GitHub secret namespaces must start with system/github/');
  });

  it('passes an optional webhook delivery source to integration composition', async () => {
    const webhookDeliverySource = {createService: vi.fn()};

    await defaultModules({webhookDeliverySource});

    expect(mocks.createIntegrationsContext).toHaveBeenCalledWith(
      expect.objectContaining({webhookDeliverySource}),
    );
  });
});
