import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {RepositoryAuthorizerConfigurationError} from './errors.js';
import {
  createRepositoryAuthorizationRequestContext,
  createRepositoryAuthorizer,
  type RepositoryAuthorizationGrantStore,
  RepositoryAuthorizationTargetInvalidError,
  repositoryAuthorizationClientErrorCode,
  repositoryAuthorizationClientErrorCodes,
  resolveRepositoryAuthorization,
} from './repository-authorizer.js';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  reportError: vi.fn(() => 'event-id'),
}));

vi.mock('@shipfox/node-error-monitoring', () => ({reportError: mocks.reportError}));
vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({error: mocks.loggerError}),
}));

const workspaceId = 'workspace-1';
const connectionId = 'connection-1';

function createProjects(
  overrides: {
    getProjectBySource?: ProjectsModuleClient['getProjectBySource'];
    findProjectBySourceRepositoryName?: ProjectsModuleClient['findProjectBySourceRepositoryName'];
  } = {},
): ProjectsModuleClient {
  return {
    getProjectBySource: vi.fn().mockResolvedValue({project: null}),
    findProjectBySourceRepositoryName: vi.fn().mockResolvedValue({projects: []}),
    ...overrides,
  } as unknown as ProjectsModuleClient;
}

function createGrants(
  overrides: Partial<RepositoryAuthorizationGrantStore> = {},
): RepositoryAuthorizationGrantStore {
  return {
    getByExternalId: vi.fn().mockResolvedValue(undefined),
    listByName: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function selectedInput(
  repository:
    | {kind: 'external-id'; externalRepositoryId: string}
    | {kind: 'name'; owner: string; name: string},
) {
  return {
    workspaceId,
    connectionId,
    mode: 'selected' as const,
    repository,
    capability: 'checkout' as const,
  };
}

describe('repository authorization', () => {
  beforeEach(() => {
    mocks.loggerError.mockReset();
    mocks.reportError.mockReset();
    mocks.reportError.mockReturnValue('event-id');
  });

  it('authorizes an exact external-id project match and returns stored metadata', async () => {
    const projects = createProjects({
      getProjectBySource: vi.fn().mockResolvedValue({
        project: {
          id: 'project-1',
          sourceExternalRepositoryId: 'github:42',
          sourceRepositoryOwner: 'Shipfox',
          sourceRepositoryName: 'Platform',
        },
      }),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'}),
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {
        externalRepositoryId: 'github:42',
        owner: 'Shipfox',
        name: 'Platform',
      },
      targetProjectId: 'project-1',
    });
    expect(projects.getProjectBySource).toHaveBeenCalledWith({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: 'github:42',
    });
    expect(projects.findProjectBySourceRepositoryName).not.toHaveBeenCalled();
  });

  it('authorizes an external-id project when display metadata is absent', async () => {
    const projects = createProjects({
      getProjectBySource: vi.fn().mockResolvedValue({
        project: {
          id: 'project-1',
          sourceExternalRepositoryId: 'github:42',
          sourceRepositoryOwner: null,
          sourceRepositoryName: undefined,
        },
      }),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'}),
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {externalRepositoryId: 'github:42'},
      targetProjectId: 'project-1',
    });
  });

  it('denies an external-id with no matching project', async () => {
    const projects = createProjects();

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'github:missing'}),
      }),
    ).resolves.toEqual({authorized: false, reason: 'repository_not_granted'});
  });

  it('authorizes an exact external-id manual grant', async () => {
    const grants = createGrants({
      getByExternalId: vi.fn().mockResolvedValue({
        externalRepositoryId: 'github:42',
        repositoryOwner: 'Shipfox',
        repositoryName: 'Platform',
      }),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects: createProjects(),
        grants,
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'}),
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {
        externalRepositoryId: 'github:42',
        owner: 'Shipfox',
        name: 'Platform',
      },
    });
  });

  it('passes selected external IDs through as exact project lookup keys', async () => {
    const getProjectBySource = vi.fn().mockResolvedValue({
      project: {
        id: 'project-1',
        sourceExternalRepositoryId: 'shipfox/project',
      },
    });
    const projects = createProjects({getProjectBySource});

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'shipfox/project'}),
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {externalRepositoryId: 'shipfox/project'},
      targetProjectId: 'project-1',
    });
    expect(getProjectBySource).toHaveBeenCalledWith(
      expect.objectContaining({sourceExternalRepositoryId: 'shipfox/project'}),
    );
  });

  it('uses the Projects name lookup for case-insensitive selected targets', async () => {
    const findProjectBySourceRepositoryName = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 'project-1',
          sourceExternalRepositoryId: 'github:42',
          sourceRepositoryOwner: 'Shipfox',
          sourceRepositoryName: 'Platform',
        },
      ],
    });
    const projects = createProjects({findProjectBySourceRepositoryName});

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'name', owner: 'shipFOX', name: 'PLATFORM'}),
      }),
    ).resolves.toMatchObject({
      authorized: true,
      repository: {externalRepositoryId: 'github:42'},
      targetProjectId: 'project-1',
    });
    expect(findProjectBySourceRepositoryName).toHaveBeenCalledWith({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: 'shipFOX',
      sourceRepositoryName: 'PLATFORM',
    });
  });

  it('denies a name with no matching project', async () => {
    const projects = createProjects();

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'name', owner: 'shipfox', name: 'missing'}),
      }),
    ).resolves.toEqual({authorized: false, reason: 'repository_not_granted'});
  });

  it('authorizes a name matched by a manual grant without a project', async () => {
    const grants = createGrants({
      listByName: vi.fn().mockResolvedValue([
        {
          externalRepositoryId: 'github:42',
          repositoryOwner: 'Shipfox',
          repositoryName: 'Platform',
        },
      ]),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects: createProjects(),
        grants,
        ...selectedInput({kind: 'name', owner: 'shipfox', name: 'platform'}),
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {
        externalRepositoryId: 'github:42',
        owner: 'Shipfox',
        name: 'Platform',
      },
    });
  });

  it('deduplicates project and manual-grant provenance by external repository id', async () => {
    const projects = createProjects({
      findProjectBySourceRepositoryName: vi.fn().mockResolvedValue({
        projects: [
          {
            id: 'project-1',
            sourceExternalRepositoryId: 'github:42',
            sourceRepositoryOwner: 'shipfox',
            sourceRepositoryName: 'platform',
          },
        ],
      }),
    });
    const grants = createGrants({
      listByName: vi.fn().mockResolvedValue([
        {
          externalRepositoryId: 'github:42',
          repositoryOwner: 'Shipfox',
          repositoryName: 'Platform',
        },
      ]),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects,
        grants,
        ...selectedInput({kind: 'name', owner: 'shipfox', name: 'platform'}),
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {
        externalRepositoryId: 'github:42',
        owner: 'shipfox',
        name: 'platform',
      },
      targetProjectId: 'project-1',
    });
  });

  it('denies a name when project and manual-grant matches have distinct ids', async () => {
    const projects = createProjects({
      findProjectBySourceRepositoryName: vi.fn().mockResolvedValue({
        projects: [
          {
            id: 'project-1',
            sourceExternalRepositoryId: 'github:42',
            sourceRepositoryOwner: 'shipfox',
            sourceRepositoryName: 'platform',
          },
        ],
      }),
    });
    const grants = createGrants({
      listByName: vi.fn().mockResolvedValue([
        {
          externalRepositoryId: 'github:43',
          repositoryOwner: 'shipfox',
          repositoryName: 'platform',
        },
      ]),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects,
        grants,
        ...selectedInput({kind: 'name', owner: 'shipfox', name: 'platform'}),
      }),
    ).resolves.toEqual({authorized: false, reason: 'repository_ambiguous'});
  });

  it('denies an ambiguous name after deduplicating rows by external repository id', async () => {
    const projects = createProjects({
      findProjectBySourceRepositoryName: vi.fn().mockResolvedValue({
        projects: [
          {
            id: 'project-1',
            sourceExternalRepositoryId: 'github:42',
            sourceRepositoryOwner: 'shipfox',
            sourceRepositoryName: 'platform',
          },
          {
            id: 'project-2',
            sourceExternalRepositoryId: 'github:42',
            sourceRepositoryOwner: 'shipfox',
            sourceRepositoryName: 'platform',
          },
          {
            id: 'project-3',
            sourceExternalRepositoryId: 'github:43',
            sourceRepositoryOwner: 'shipfox',
            sourceRepositoryName: 'platform',
          },
        ],
      }),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'name', owner: 'shipfox', name: 'platform'}),
      }),
    ).resolves.toEqual({authorized: false, reason: 'repository_ambiguous'});
  });

  it.each([
    'getProjectBySource',
    'findProjectBySourceRepositoryName',
  ] as const)('distinguishes a %s failure from a repository denial', async (method) => {
    const projects = createProjects({
      [method]: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });
    const repository =
      method === 'getProjectBySource'
        ? {kind: 'external-id' as const, externalRepositoryId: 'github:42'}
        : {kind: 'name' as const, owner: 'shipfox', name: 'platform'};

    await expect(
      resolveRepositoryAuthorization({projects, ...selectedInput(repository)}),
    ).resolves.toEqual({authorized: false, reason: 'authorization_store_unavailable'});
  });

  it.each([
    'getByExternalId',
    'listByName',
  ] as const)('distinguishes a %s grant-store failure from a repository denial', async (method) => {
    const grants = createGrants({
      [method]: vi.fn().mockRejectedValue(new Error('grant store unavailable')),
    });
    const repository =
      method === 'getByExternalId'
        ? {kind: 'external-id' as const, externalRepositoryId: 'github:42'}
        : {kind: 'name' as const, owner: 'shipfox', name: 'platform'};

    await expect(
      resolveRepositoryAuthorization({
        projects: createProjects(),
        grants,
        ...selectedInput(repository),
      }),
    ).resolves.toEqual({authorized: false, reason: 'authorization_store_unavailable'});
  });

  it('accepts valid all-mode declarations without consulting Projects', async () => {
    const projects = createProjects({
      getProjectBySource: vi.fn().mockRejectedValue(new Error('must not be called')),
      findProjectBySourceRepositoryName: vi.fn().mockRejectedValue(new Error('must not be called')),
    });
    const grants = createGrants({
      getByExternalId: vi.fn().mockRejectedValue(new Error('must not be called')),
      listByName: vi.fn().mockRejectedValue(new Error('must not be called')),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects,
        grants,
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'}),
        mode: 'all',
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {externalRepositoryId: 'github:42'},
    });
    await expect(
      resolveRepositoryAuthorization({
        projects,
        grants,
        ...selectedInput({kind: 'name', owner: 'shipfox', name: 'platform'}),
        mode: 'all',
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {owner: 'shipfox', name: 'platform'},
    });
    expect(projects.getProjectBySource).not.toHaveBeenCalled();
    expect(projects.findProjectBySourceRepositoryName).not.toHaveBeenCalled();
    expect(grants.getByExternalId).not.toHaveBeenCalled();
    expect(grants.listByName).not.toHaveBeenCalled();
  });

  it.each([
    {kind: 'external-id' as const, externalRepositoryId: '42'},
    {kind: 'external-id' as const, externalRepositoryId: ':42'},
    {kind: 'name' as const, owner: 'shipfox/team', name: 'platform'},
    {kind: 'name' as const, owner: 'shipfox', name: 'platform name'},
  ])('rejects an invalid declaration target: %j', async (repository) => {
    await expect(
      resolveRepositoryAuthorization({
        projects: createProjects(),
        ...selectedInput(repository),
        mode: 'all',
      }),
    ).rejects.toBeInstanceOf(RepositoryAuthorizationTargetInvalidError);
  });

  it('rejects an unsafe selected external-id target', async () => {
    await expect(
      resolveRepositoryAuthorization({
        projects: createProjects(),
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'github:4 2'}),
      }),
    ).rejects.toBeInstanceOf(RepositoryAuthorizationTargetInvalidError);
  });

  it('memoizes selected lookups within one request context only', async () => {
    const getProjectBySource = vi.fn().mockResolvedValue({
      project: {
        id: 'project-1',
        sourceExternalRepositoryId: 'github:42',
        sourceRepositoryOwner: 'shipfox',
        sourceRepositoryName: 'platform',
      },
    });
    const projects = createProjects({getProjectBySource});
    const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'});
    const request = createRepositoryAuthorizationRequestContext();

    await resolveRepositoryAuthorization({projects, ...input, request});
    await resolveRepositoryAuthorization({projects, ...input, request});
    await resolveRepositoryAuthorization({
      projects,
      ...input,
      request: createRepositoryAuthorizationRequestContext(),
    });

    expect(getProjectBySource).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent lookups and does not memoize store failures', async () => {
    const getProjectBySource = vi
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({
        project: {
          id: 'project-1',
          sourceExternalRepositoryId: 'github:42',
        },
      });
    const projects = createProjects({getProjectBySource});
    const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'});
    const request = createRepositoryAuthorizationRequestContext();

    const [first, second] = await Promise.all([
      resolveRepositoryAuthorization({projects, ...input, request}),
      resolveRepositoryAuthorization({projects, ...input, request}),
    ]);

    expect(first).toEqual({authorized: false, reason: 'authorization_store_unavailable'});
    expect(second).toEqual({authorized: false, reason: 'authorization_store_unavailable'});
    expect(getProjectBySource).toHaveBeenCalledOnce();
    expect(request.memo.size).toBe(0);

    await expect(resolveRepositoryAuthorization({projects, ...input, request})).resolves.toEqual({
      authorized: true,
      repository: {externalRepositoryId: 'github:42'},
      targetProjectId: 'project-1',
    });
    expect(getProjectBySource).toHaveBeenCalledTimes(2);
  });

  it('shares positive selected decisions for 30 seconds and then refreshes them', async () => {
    let now = 0;
    const getProjectBySource = vi.fn().mockResolvedValue({
      project: {
        id: 'project-1',
        sourceExternalRepositoryId: 'github:42',
      },
    });
    const authorizer = createRepositoryAuthorizer({
      projects: createProjects({getProjectBySource}),
      grants: createGrants(),
      enabled: true,
      now: () => now,
    });
    const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'});

    await authorizer.resolveRepositoryAuthorization({
      ...input,
      request: createRepositoryAuthorizationRequestContext(),
    });
    await authorizer.resolveRepositoryAuthorization({
      ...input,
      request: createRepositoryAuthorizationRequestContext(),
    });
    expect(getProjectBySource).toHaveBeenCalledOnce();

    now = 30_000;
    await authorizer.resolveRepositoryAuthorization({
      ...input,
      request: createRepositoryAuthorizationRequestContext(),
    });
    expect(getProjectBySource).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate a connection cache after invalidation during an in-flight lookup', async () => {
    let releaseProject:
      | ((result: {project: {id: string; sourceExternalRepositoryId: string}}) => void)
      | undefined;
    const pendingProject = new Promise<{project: {id: string; sourceExternalRepositoryId: string}}>(
      (resolve) => {
        releaseProject = resolve;
      },
    );
    const getProjectBySource = vi
      .fn()
      .mockReturnValueOnce(pendingProject)
      .mockResolvedValueOnce({project: null});
    const authorizer = createRepositoryAuthorizer({
      projects: createProjects({getProjectBySource}),
      grants: createGrants(),
      enabled: true,
    });
    const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'});

    const inFlight = authorizer.resolveRepositoryAuthorization(input);
    await vi.waitFor(() => expect(getProjectBySource).toHaveBeenCalledOnce());
    authorizer.invalidateRepositoryAuthorizationCache?.(connectionId);
    releaseProject?.({
      project: {id: 'project-1', sourceExternalRepositoryId: 'github:42'},
    });

    await expect(inFlight).resolves.toMatchObject({authorized: true});
    await expect(authorizer.resolveRepositoryAuthorization(input)).resolves.toEqual({
      authorized: false,
      reason: 'repository_not_granted',
    });
    expect(getProjectBySource).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest positive decision when the cache reaches its configured capacity', async () => {
    const getProjectBySource = vi.fn(
      async (input: Parameters<ProjectsModuleClient['getProjectBySource']>[0]) => ({
        project: {
          id: input.sourceExternalRepositoryId,
          workspaceId: input.workspaceId,
          sourceConnectionId: input.sourceConnectionId,
          sourceExternalRepositoryId: input.sourceExternalRepositoryId,
          name: input.sourceExternalRepositoryId,
        },
      }),
    );
    const authorizer = createRepositoryAuthorizer({
      projects: createProjects({getProjectBySource}),
      grants: createGrants(),
      enabled: true,
      maxCacheEntries: 1,
    });

    await authorizer.resolveRepositoryAuthorization(
      selectedInput({kind: 'external-id', externalRepositoryId: 'github:1'}),
    );
    await authorizer.resolveRepositoryAuthorization(
      selectedInput({kind: 'external-id', externalRepositoryId: 'github:2'}),
    );
    await authorizer.resolveRepositoryAuthorization(
      selectedInput({kind: 'external-id', externalRepositoryId: 'github:1'}),
    );

    expect(getProjectBySource).toHaveBeenCalledTimes(3);
  });

  it.each([
    0,
    Number.NaN,
  ])('falls back to a bounded cache for invalid capacity %s', async (maxCacheEntries) => {
    const getProjectBySource = vi.fn().mockResolvedValue({
      project: {id: 'project-1', sourceExternalRepositoryId: 'github:1'},
    });
    const authorizer = createRepositoryAuthorizer({
      projects: createProjects({getProjectBySource}),
      grants: createGrants(),
      enabled: true,
      maxCacheEntries,
    });
    const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:1'});

    await authorizer.resolveRepositoryAuthorization(input);
    await authorizer.resolveRepositoryAuthorization(input);

    expect(getProjectBySource).toHaveBeenCalledOnce();
  });

  it('does not share denials between request contexts', async () => {
    const getProjectBySource = vi
      .fn()
      .mockResolvedValueOnce({project: null})
      .mockResolvedValueOnce({
        project: {
          id: 'project-1',
          sourceExternalRepositoryId: 'github:42',
        },
      });
    const authorizer = createRepositoryAuthorizer({
      projects: createProjects({getProjectBySource}),
      grants: createGrants(),
      enabled: true,
    });
    const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'});

    await expect(
      authorizer.resolveRepositoryAuthorization({
        ...input,
        request: createRepositoryAuthorizationRequestContext(),
      }),
    ).resolves.toEqual({authorized: false, reason: 'repository_not_granted'});
    await expect(
      authorizer.resolveRepositoryAuthorization({
        ...input,
        request: createRepositoryAuthorizationRequestContext(),
      }),
    ).resolves.toMatchObject({authorized: true});
    expect(getProjectBySource).toHaveBeenCalledTimes(2);
  });

  it('invalidates positive decisions for a connection immediately', async () => {
    const getProjectBySource = vi.fn().mockResolvedValue({
      project: {
        id: 'project-1',
        sourceExternalRepositoryId: 'github:42',
      },
    });
    const authorizer = createRepositoryAuthorizer({
      projects: createProjects({getProjectBySource}),
      grants: createGrants(),
      enabled: true,
    });
    const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'});

    await expect(authorizer.resolveRepositoryAuthorization(input)).resolves.toMatchObject({
      authorized: true,
    });
    getProjectBySource.mockResolvedValue({project: null});
    authorizer.invalidateRepositoryAuthorizationCache?.(connectionId);

    await expect(authorizer.resolveRepositoryAuthorization(input)).resolves.toEqual({
      authorized: false,
      reason: 'repository_not_granted',
    });
    expect(getProjectBySource).toHaveBeenCalledTimes(2);
  });

  it('does not allow a disabled gate to invoke the Projects client', async () => {
    const projects = createProjects({
      getProjectBySource: vi.fn().mockRejectedValue(new Error('must not be called')),
    });
    const authorizer = createRepositoryAuthorizer({projects});

    expect(authorizer.enabled).toBe(false);
    await expect(
      authorizer.resolveRepositoryAuthorization({
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'not-even-a-target'}),
      }),
    ).resolves.toBeUndefined();
    expect(projects.getProjectBySource).not.toHaveBeenCalled();
  });

  it('rejects an enabled gate without a Projects client', () => {
    expect(() => createRepositoryAuthorizer({enabled: true})).toThrow(
      RepositoryAuthorizerConfigurationError,
    );
  });

  it('rethrows cancellation errors without converting them to a denial', async () => {
    const cancellation = Object.assign(new Error('request aborted'), {name: 'AbortError'});
    const projects = createProjects({
      getProjectBySource: vi.fn().mockRejectedValue(cancellation),
    });

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'}),
      }),
    ).rejects.toBe(cancellation);
  });

  it('rate-limits store failure reports while allowing retries', async () => {
    vi.useFakeTimers({now: new Date('2026-08-31T00:00:00.000Z')});
    vi.resetModules();
    try {
      const {resolveRepositoryAuthorization: resolve} = await import('./repository-authorizer.js');
      vi.advanceTimersByTime(60_001);
      const getProjectBySource = vi
        .fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockRejectedValueOnce(new Error('database unavailable'));
      const projects = createProjects({getProjectBySource});
      const input = selectedInput({kind: 'external-id', externalRepositoryId: 'github:42'});

      await resolve({projects, ...input});
      await resolve({projects, ...input});
      expect(mocks.reportError).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(60_000);
      await resolve({projects, ...input});
      expect(mocks.reportError).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the provider-free authorizer when the integration gate is enabled', async () => {
    const projects = createProjects();
    const authorizer = createRepositoryAuthorizer({projects, enabled: true});

    expect(authorizer.enabled).toBe(true);
    await expect(
      authorizer.resolveRepositoryAuthorization({
        ...selectedInput({kind: 'name', owner: 'shipfox', name: 'platform'}),
        mode: 'all',
      }),
    ).resolves.toEqual({
      authorized: true,
      repository: {owner: 'shipfox', name: 'platform'},
    });
  });

  it('publishes closed client error codes for each denial reason', () => {
    expect(repositoryAuthorizationClientErrorCodes).toEqual({
      repository_required: 'repository-required',
      repository_not_granted: 'repository-not-granted',
      repository_ambiguous: 'repository-ambiguous',
      authorization_store_unavailable: 'repository-authorization-unavailable',
    });
    expect(repositoryAuthorizationClientErrorCode('repository_ambiguous')).toBe(
      'repository-ambiguous',
    );
  });
});
