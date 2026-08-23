import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq, sql} from 'drizzle-orm';
import {DefinitionAtRefError} from '#core/errors.js';
import {listDefinitionsAtRef, resolveDefinitionAtRef} from '#core/resolve-definition-at-ref.js';
import {db} from '#db/db.js';
import {workflowDefinitions} from '#db/schema/definitions.js';
import {definitionsOutbox} from '#db/schema/outbox.js';
import {workflowWorkflows} from '#db/schema/workflows.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';

const metrics = vi.hoisted(() => ({
  recordDefinitionRefResolution: vi.fn(),
}));

vi.mock('#metrics/index.js', () => metrics);

const COMMIT = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const CONFIG_PATH = '.shipfox/workflows/ci.yml';

const validYaml = `
name: CI
runner: ubuntu-latest
triggers:
  on_demand:
    source: manual
    event: fire
  on_push:
    source: github_acme
    event: push
    filter: event.ref == "refs/heads/main"
jobs:
  build:
    steps:
      - run: pnpm test
`;

const warningYaml = `
name: Warning only
runner: ubuntu-latest
jobs:
  build:
    steps:
      - env:
          MSG: '${'$'.concat('{{ event.x }}')}'
        run: eval "$MSG"
`;

const invalidYaml = `
name: Bad YAML
jobs:
  build:
    steps:
      - run: echo hello
      invalid indentation here
`;

const integrationYaml = `
name: Agent CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - prompt: Fix the issue
        integrations:
          - connection: github-main
            include: [issue_read]
`;

const invalidIntegrationYaml = `
name: Agent CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - prompt: Fix the issue
        integrations:
          - connection: github-main
            include: [issue_read.missing]
`;

const agentToolsContext = {
  selectionCatalogs: [
    {
      provider: 'github',
      selectors: [
        {token: 'issue_read', kind: 'family', sensitivity: 'read', sensitive: false},
        {token: 'issue_read.get', kind: 'method', sensitivity: 'read', sensitive: false},
      ],
    },
  ],
  catalogs: [],
  workspaceConnections: [
    {
      id: 'connection-1',
      provider: 'github',
      slug: 'github-main',
      capabilities: ['agent_tools'],
    },
  ],
  eventCatalogs: [],
  fixedEventProviders: [],
  defaultConnection: {id: 'connection-1', slug: 'github-main', provider: 'github'},
};

interface Clients {
  projects: ProjectsModuleClient;
  integrations: IntegrationsModuleClient;
  agent: AgentInterModuleClient;
}

function makeClients(projectId = crypto.randomUUID()): Clients {
  const project = {
    id: projectId,
    workspaceId: crypto.randomUUID(),
    sourceConnectionId: crypto.randomUUID(),
    sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
    name: 'Platform',
  };
  return {
    projects: {
      getProjectById: vi.fn(async () => ({project})),
    } as unknown as ProjectsModuleClient,
    integrations: {
      resolveSourceRef: vi.fn(async () => ({ref: 'fix-branch', commit: COMMIT})),
      fetchSourceFile: vi.fn(async () => ({path: CONFIG_PATH, ref: COMMIT, content: validYaml})),
      listSourceFiles: vi.fn(async () => ({
        files: [{path: CONFIG_PATH, type: 'file', size: validYaml.length}],
        nextCursor: null,
      })),
      getAgentToolsContext: vi.fn(async () => agentToolsContext),
    } as unknown as IntegrationsModuleClient,
    agent: {
      getValidationCatalog: vi.fn(async () => agentValidationCatalog),
    } as unknown as AgentInterModuleClient,
  };
}

function withClients(overrides: {
  projects?: Partial<ProjectsModuleClient>;
  integrations?: Partial<IntegrationsModuleClient>;
  agent?: Partial<AgentInterModuleClient>;
}) {
  const clients = makeClients();
  return {
    ...clients,
    projects: {...clients.projects, ...overrides.projects} as ProjectsModuleClient,
    integrations: {...clients.integrations, ...overrides.integrations} as IntegrationsModuleClient,
    agent: {...clients.agent, ...overrides.agent} as AgentInterModuleClient,
  };
}

async function expectRefError(
  promise: Promise<unknown>,
  code: DefinitionAtRefError['code'],
): Promise<DefinitionAtRefError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DefinitionAtRefError);
  expect((error as DefinitionAtRefError).code).toBe(code);
  return error as DefinitionAtRefError;
}

async function countLineageRows(projectId: string) {
  return await db()
    .select({id: workflowWorkflows.id})
    .from(workflowWorkflows)
    .where(eq(workflowWorkflows.projectId, projectId));
}

async function countOutboxRows(projectId: string) {
  return await db()
    .select({id: definitionsOutbox.id})
    .from(definitionsOutbox)
    .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
}

beforeEach(() => {
  metrics.recordDefinitionRefResolution.mockReset();
});

describe('resolveDefinitionAtRef', () => {
  test('resolves a valid definition at the pinned commit and creates only the lineage', async () => {
    const projectId = crypto.randomUUID();
    const clients = makeClients(projectId);

    const result = await resolveDefinitionAtRef({
      projectId,
      ref: 'fix-branch',
      configPath: CONFIG_PATH,
      ...clients,
    });

    expect(result.commit).toBe(COMMIT);
    expect(result.workflow.configPath).toBe(CONFIG_PATH);
    expect(result.model).toEqual({version: 2, model: expect.any(Object)});
    expect(result.sourceSnapshot).toEqual({content: validYaml, format: 'yaml'});
    expect(Object.keys(result.triggers)).toEqual(['on_demand', 'on_push']);
    expect(result.triggers.on_demand).toEqual({source: 'manual', event: 'fire'});
    expect(result.triggers.on_push).toMatchObject({
      source: 'github_acme',
      event: 'push',
      filter: 'event.ref == "refs/heads/main"',
    });
    expect(result.warnings).toEqual([]);

    // The file is fetched at the commit, never at the name.
    expect(clients.integrations.fetchSourceFile).toHaveBeenCalledWith(
      expect.objectContaining({ref: COMMIT, path: CONFIG_PATH}),
    );

    // Only the lineage row exists: no definition row and no outbox event.
    const lineages = await countLineageRows(projectId);
    expect(lineages).toHaveLength(1);
    expect(lineages[0]?.id).toBe(result.workflow.id);
    const definitions = await db()
      .select({id: workflowDefinitions.id})
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.projectId, projectId));
    expect(definitions).toHaveLength(0);
    expect(await countOutboxRows(projectId)).toHaveLength(0);
    expect(metrics.recordDefinitionRefResolution).toHaveBeenCalledWith('resolved');
  });

  test('reuses the lineage across calls so dev runs share numbering', async () => {
    const projectId = crypto.randomUUID();
    const clients = makeClients(projectId);

    const first = await resolveDefinitionAtRef({
      projectId,
      ref: 'fix-branch',
      configPath: CONFIG_PATH,
      ...clients,
    });
    const second = await resolveDefinitionAtRef({
      projectId,
      ref: 'fix-branch',
      configPath: CONFIG_PATH,
      ...clients,
    });

    expect(second.workflow.id).toBe(first.workflow.id);
    expect(await countLineageRows(projectId)).toHaveLength(1);
    expect(await countOutboxRows(projectId)).toHaveLength(0);
  });

  test('answers project-not-found for an unknown project', async () => {
    const clients = withClients({
      projects: {getProjectById: async () => ({project: null})},
    });
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'project-not-found',
    );
    expect(error.details).toMatchObject({projectId: expect.any(String)});
  });

  test('answers ref-not-found when the ref does not resolve', async () => {
    const clients = withClients({
      integrations: {
        resolveSourceRef: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.resolveSourceRef,
            'ref-not-found',
            {ref: 'missing-branch'},
          );
        },
      },
    });
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'missing-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'ref-not-found',
    );
    expect(error.details).toEqual({ref: 'missing-branch'});
  });

  test('answers ref-invalid for a raw commit sha or pull-request ref', async () => {
    const clients = withClients({
      integrations: {
        resolveSourceRef: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.resolveSourceRef,
            'ref-invalid',
            {ref: 'refs/pull/12/head'},
          );
        },
      },
    });
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'refs/pull/12/head',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'ref-invalid',
    );
    expect(error.details).toEqual({ref: 'refs/pull/12/head'});
  });

  test('answers source-unavailable when the source control call fails', async () => {
    const clients = withClients({
      integrations: {
        resolveSourceRef: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.resolveSourceRef,
            'provider-failure',
            {reason: 'provider-unavailable'},
          );
        },
      },
    });
    await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'source-unavailable',
    );
  });

  test('answers ref-moved when expectedCommit no longer matches', async () => {
    const projectId = crypto.randomUUID();
    const clients = makeClients(projectId);
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId,
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        expectedCommit: '9'.repeat(40),
        ...clients,
      }),
      'ref-moved',
    );
    expect(error.details).toEqual({ref: 'fix-branch', expectedCommit: '9'.repeat(40)});
    expect(await countLineageRows(projectId)).toHaveLength(0);
    expect(metrics.recordDefinitionRefResolution).toHaveBeenCalledWith('ref-moved');
  });

  test('resolves when expectedCommit still matches', async () => {
    const clients = makeClients();
    const result = await resolveDefinitionAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      configPath: CONFIG_PATH,
      expectedCommit: COMMIT,
      ...clients,
    });
    expect(result.commit).toBe(COMMIT);
  });

  test('answers file-not-found when the file is missing at the commit', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.fetchSourceFile,
            'provider-failure',
            {reason: 'file-not-found'},
          );
        },
      },
    });
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'file-not-found',
    );
    expect(error.details).toEqual({ref: 'fix-branch', configPath: CONFIG_PATH});
  });

  test('answers source-unavailable when the file fetch fails', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.fetchSourceFile,
            'connection-inactive',
            {connectionId: crypto.randomUUID()},
          );
        },
      },
    });
    await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'source-unavailable',
    );
  });

  test('answers content-too-large for a file over the sync limit', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: async () => ({
          path: CONFIG_PATH,
          ref: COMMIT,
          content: `# ${'x'.repeat(1_000_001)}`,
        }),
      },
    });
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'content-too-large',
    );
    expect(error.details).toEqual({configPath: CONFIG_PATH});
  });

  test('stops before creating lineage when the request is cancelled', async () => {
    const projectId = crypto.randomUUID();
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const clients = withClients({
      integrations: {
        fetchSourceFile: () => {
          controller.abort(reason);
          return Promise.resolve({path: CONFIG_PATH, ref: COMMIT, content: validYaml});
        },
      },
    });

    await expect(
      resolveDefinitionAtRef({
        projectId,
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        signal: controller.signal,
        ...clients,
      }),
    ).rejects.toBe(reason);
    expect(await countLineageRows(projectId)).toHaveLength(0);
    expect(metrics.recordDefinitionRefResolution).not.toHaveBeenCalled();
  });

  test('answers invalid-definition with the validate-route error shape', async () => {
    const projectId = crypto.randomUUID();
    const clients = withClients({
      integrations: {
        fetchSourceFile: async () => ({path: CONFIG_PATH, ref: COMMIT, content: invalidYaml}),
      },
    });
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId,
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'invalid-definition',
    );
    expect(error.details.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({message: expect.any(String)})]),
    );
    expect(await countLineageRows(projectId)).toHaveLength(0);
    expect(metrics.recordDefinitionRefResolution).toHaveBeenCalledWith('invalid-definition');
  });

  test('runs the two-pass integration validation like sync', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: async () => ({
          path: CONFIG_PATH,
          ref: COMMIT,
          content: invalidIntegrationYaml,
        }),
      },
    });
    const error = await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'invalid-definition',
    );
    expect(error.details.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({message: expect.any(String)})]),
    );
    expect(clients.integrations.getAgentToolsContext).toHaveBeenCalled();

    const validClients = withClients({
      integrations: {
        fetchSourceFile: async () => ({
          path: CONFIG_PATH,
          ref: COMMIT,
          content: integrationYaml,
        }),
      },
    });
    const resolved = await resolveDefinitionAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      configPath: CONFIG_PATH,
      ...validClients,
    });
    expect(resolved.triggers).toEqual({});
    expect(validClients.integrations.getAgentToolsContext).toHaveBeenCalled();
  });

  test('answers source-unavailable when integration validation context loading fails', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: async () => ({path: CONFIG_PATH, ref: COMMIT, content: integrationYaml}),
        getAgentToolsContext: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.getAgentToolsContext,
            'connection-inactive',
            {connectionId: crypto.randomUUID()},
          );
        },
      },
    });

    await expectRefError(
      resolveDefinitionAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        configPath: CONFIG_PATH,
        ...clients,
      }),
      'source-unavailable',
    );
    expect(metrics.recordDefinitionRefResolution).toHaveBeenCalledWith('source-unavailable');
  });

  test('returns validation warnings for warning-only diagnostics', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: async () => ({path: CONFIG_PATH, ref: COMMIT, content: warningYaml}),
      },
    });
    const result = await resolveDefinitionAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      configPath: CONFIG_PATH,
      ...clients,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toEqual(
      expect.objectContaining({code: expect.any(String), message: expect.any(String)}),
    );
  });
});

describe('listDefinitionsAtRef', () => {
  test('lists files with validation state and the pinned commit', async () => {
    const clients = withClients({
      integrations: {
        listSourceFiles: vi.fn(async () => ({
          files: [
            {path: CONFIG_PATH, type: 'file' as const, size: validYaml.length},
            {path: '.shipfox/workflows/README.md', type: 'file' as const, size: 8},
          ],
          nextCursor: null,
        })),
      },
    });
    const result = await listDefinitionsAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      ...clients,
    });

    expect(result.commit).toBe(COMMIT);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      configPath: CONFIG_PATH,
      name: 'CI',
      valid: true,
      errors: [],
      warnings: [],
      triggers: expect.objectContaining({on_demand: {source: 'manual', event: 'fire'}}),
    });
    expect(clients.integrations.listSourceFiles).toHaveBeenCalledWith(
      expect.objectContaining({ref: COMMIT, prefix: '.shipfox/workflows/', limit: 100}),
    );
  });

  test('reports an invalid file without failing the listing', async () => {
    const invalidPath = '.shipfox/workflows/broken.yml';
    const clients = withClients({
      integrations: {
        listSourceFiles: async () => ({
          files: [
            {path: CONFIG_PATH, type: 'file' as const, size: validYaml.length},
            {path: invalidPath, type: 'file' as const, size: invalidYaml.length},
          ],
          nextCursor: null,
        }),
        fetchSourceFile: async ({path}) => ({
          path,
          ref: COMMIT,
          content: path === invalidPath ? invalidYaml : validYaml,
        }),
      },
    });
    const result = await listDefinitionsAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      ...clients,
    });

    expect(result.files).toHaveLength(2);
    const valid = result.files.find((file) => file.configPath === CONFIG_PATH);
    const invalid = result.files.find((file) => file.configPath === invalidPath);
    expect(valid).toMatchObject({valid: true, name: 'CI', errors: []});
    expect(invalid).toMatchObject({
      valid: false,
      name: null,
      warnings: [],
      triggers: {},
    });
    expect(invalid?.errors.length).toBeGreaterThan(0);
    expect(invalid?.errors[0]).toEqual(expect.objectContaining({message: expect.any(String)}));
  });

  test('reports a file over the size limit as invalid', async () => {
    const hugePath = '.shipfox/workflows/huge.yml';
    const clients = withClients({
      integrations: {
        listSourceFiles: async () => ({
          files: [{path: hugePath, type: 'file' as const, size: 1_000_001}],
          nextCursor: null,
        }),
        fetchSourceFile: async () => ({
          path: hugePath,
          ref: COMMIT,
          content: `# ${'x'.repeat(1_000_001)}`,
        }),
      },
    });
    const result = await listDefinitionsAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      ...clients,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      valid: false,
      errors: [{message: expect.stringContaining('larger than')}],
    });
  });

  test('answers too-many-files when the sync file limit is exceeded', async () => {
    const files = Array.from({length: 150}, (_, index) => ({
      path: `.shipfox/workflows/wf-${index}.yml`,
      type: 'file' as const,
      size: 1,
    }));
    const clients = withClients({
      integrations: {
        listSourceFiles: async () => ({files, nextCursor: 'more'}),
        fetchSourceFile: async ({path}) => ({path, ref: COMMIT, content: validYaml}),
      },
    });
    await expectRefError(
      listDefinitionsAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        ...clients,
      }),
      'too-many-files',
    );
    expect(metrics.recordDefinitionRefResolution).toHaveBeenCalledWith('too-many-files');
  });

  test('reports a file that fails to fetch as invalid', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.fetchSourceFile,
            'provider-failure',
            {reason: 'file-not-found'},
          );
        },
      },
    });
    const result = await listDefinitionsAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      ...clients,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({valid: false, name: null});
  });

  test('answers source-unavailable when a listed file cannot reach the provider', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.fetchSourceFile,
            'connection-inactive',
            {connectionId: crypto.randomUUID()},
          );
        },
      },
    });

    await expectRefError(
      listDefinitionsAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        ...clients,
      }),
      'source-unavailable',
    );
    expect(metrics.recordDefinitionRefResolution).toHaveBeenCalledWith('source-unavailable');
  });

  test('returns validation warnings for warning-only listing entries', async () => {
    const clients = withClients({
      integrations: {
        fetchSourceFile: async () => ({path: CONFIG_PATH, ref: COMMIT, content: warningYaml}),
      },
    });

    const result = await listDefinitionsAtRef({
      projectId: crypto.randomUUID(),
      ref: 'fix-branch',
      ...clients,
    });

    expect(result.files[0]?.warnings).toEqual([
      expect.objectContaining({code: expect.any(String), message: expect.any(String)}),
    ]);
  });

  test('answers the ref resolution errors', async () => {
    const missingRef = withClients({
      integrations: {
        resolveSourceRef: () => {
          throw createInterModuleKnownError(
            integrationsInterModuleContract.methods.resolveSourceRef,
            'ref-not-found',
            {ref: 'missing-branch'},
          );
        },
      },
    });
    await expectRefError(
      listDefinitionsAtRef({
        projectId: crypto.randomUUID(),
        ref: 'missing-branch',
        ...missingRef,
      }),
      'ref-not-found',
    );

    const missingProject = withClients({
      projects: {getProjectById: async () => ({project: null})},
    });
    await expectRefError(
      listDefinitionsAtRef({
        projectId: crypto.randomUUID(),
        ref: 'fix-branch',
        ...missingProject,
      }),
      'project-not-found',
    );
  });
});
