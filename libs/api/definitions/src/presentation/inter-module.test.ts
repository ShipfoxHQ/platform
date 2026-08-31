import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError, isInterModuleKnownError} from '@shipfox/inter-module';
import {DefinitionAtRefError} from '#core/errors.js';
import {createDefinitionsInterModulePresentation} from './inter-module.js';

const mocks = vi.hoisted(() => ({
  getDefinitionById: vi.fn(),
  getLatestDefinitionSyncState: vi.fn(),
  listDefinitions: vi.fn(),
  listDefinitionsAtRef: vi.fn(),
  requireProjectForWorkspace: vi.fn(),
  resolveDefinitionAtRef: vi.fn(),
}));

vi.mock('#db/definitions.js', () => ({
  getDefinitionById: mocks.getDefinitionById,
  listDefinitions: mocks.listDefinitions,
}));

vi.mock('#db/sync-states.js', () => ({
  getLatestDefinitionSyncState: mocks.getLatestDefinitionSyncState,
}));

vi.mock('#core/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#core/index.js')>();
  return {
    ...original,
    listDefinitionsAtRef: mocks.listDefinitionsAtRef,
    resolveDefinitionAtRef: mocks.resolveDefinitionAtRef,
  };
});

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const REF = 'fix-branch';
const CONFIG_PATH = '.shipfox/workflows/ci.yml';
const COMMIT = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

function presentation() {
  return createDefinitionsInterModulePresentation({
    projects: {requireProjectForWorkspace: mocks.requireProjectForWorkspace} as never,
    agent: {} as never,
    integrations: {} as never,
  });
}

async function rejection(promise: Promise<unknown> | unknown): Promise<unknown> {
  return await Promise.resolve(promise).catch((error: unknown) => error);
}

describe('definitions inter-module presentation', () => {
  beforeEach(() => {
    mocks.resolveDefinitionAtRef.mockReset();
    mocks.listDefinitionsAtRef.mockReset();
    mocks.getDefinitionById.mockReset();
    mocks.getLatestDefinitionSyncState.mockReset();
    mocks.listDefinitions.mockReset();
    mocks.requireProjectForWorkspace.mockReset();
  });

  it('lists project definitions with the route shape and sync summary', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000010';
    const sourceConnectionId = '00000000-0000-4000-8000-000000000011';
    const project = {
      id: PROJECT_ID,
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'github:shipfox/project',
    };
    const definition = {
      id: '00000000-0000-4000-8000-000000000012',
      workflowId: '00000000-0000-4000-8000-000000000013',
      projectId: PROJECT_ID,
      configPath: '.shipfox/workflows/ci.yml',
      source: 'vcs' as const,
      sha: 'a1b2c3',
      ref: 'main',
      name: 'CI',
      definition: {name: 'CI'},
      document: {name: 'CI'},
      model: {triggers: [{source: 'manual', key: 'run_now'}]},
      sourceSnapshot: null,
      contentHash: null,
      fetchedAt: new Date('2026-08-05T12:00:00.000Z'),
      createdAt: new Date('2026-08-05T12:01:00.000Z'),
      updatedAt: new Date('2026-08-05T12:02:00.000Z'),
      deletedAt: null,
    };
    const syncState = {
      id: '00000000-0000-4000-8000-000000000014',
      projectId: PROJECT_ID,
      sourceConnectionId,
      sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      ref: 'main',
      status: 'succeeded' as const,
      lastErrorCode: null,
      lastErrorMessage: null,
      diagnostics: [
        {
          code: 'warning-code',
          message: 'Warning',
          path: 'jobs.build',
          filePath: '.shipfox/workflows/ci.yml',
          severity: 'warning' as const,
        },
      ],
      startedAt: new Date('2026-08-05T11:59:00.000Z'),
      finishedAt: new Date('2026-08-05T12:03:00.000Z'),
      createdAt: new Date('2026-08-05T11:59:00.000Z'),
      updatedAt: new Date('2026-08-05T12:03:00.000Z'),
    };
    const cursor = {value: 'AB', id: '00000000-0000-4000-8000-000000000015'};
    mocks.requireProjectForWorkspace.mockResolvedValue({project});
    mocks.listDefinitions.mockResolvedValue({definitions: [definition], nextCursor: cursor});
    mocks.getLatestDefinitionSyncState.mockResolvedValue(syncState);

    const result = await presentation().handlers.listDefinitionsByProject(
      {workspaceId, projectId: PROJECT_ID, limit: 1, cursor},
      {signal: new AbortController().signal},
    );

    expect(mocks.requireProjectForWorkspace).toHaveBeenCalledWith({
      workspaceId,
      projectId: PROJECT_ID,
    });
    expect(mocks.listDefinitions).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      limit: 1,
      cursor,
    });
    expect(mocks.getLatestDefinitionSyncState).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sourceConnectionId,
      sourceExternalRepositoryId: project.sourceExternalRepositoryId,
    });
    expect(
      definitionsInterModuleContract.methods.listDefinitionsByProject.output.parse(result),
    ).toEqual({
      definitions: [
        {
          id: definition.id,
          projectId: definition.projectId,
          configPath: definition.configPath,
          source: definition.source,
          sha: definition.sha,
          ref: definition.ref,
          name: definition.name,
          workflowDocument: definition.document,
          workflowModel: definition.model,
          manualTrigger: {name: 'run_now'},
          fetchedAt: definition.fetchedAt.toISOString(),
          createdAt: definition.createdAt.toISOString(),
          updatedAt: definition.updatedAt.toISOString(),
        },
      ],
      sync: {
        ref: 'main',
        status: 'succeeded',
        lastSyncAt: syncState.finishedAt.toISOString(),
        startedAt: syncState.startedAt.toISOString(),
        finishedAt: syncState.finishedAt.toISOString(),
        lastErrorCode: null,
        lastErrorMessage: null,
        diagnostics: [
          {
            code: 'warning-code',
            message: 'Warning',
            path: 'jobs.build',
            filePath: '.shipfox/workflows/ci.yml',
            severity: 'warning',
          },
        ],
      },
      nextCursor: cursor,
    });
  });

  it('denies a project from another workspace before reading definitions', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000010';
    mocks.requireProjectForWorkspace.mockRejectedValue(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-workspace-mismatch',
        {projectId: PROJECT_ID, workspaceId},
      ),
    );

    const error = await rejection(
      presentation().handlers.listDefinitionsByProject(
        {workspaceId, projectId: PROJECT_ID, limit: 50},
        {signal: new AbortController().signal},
      ),
    );

    const method = definitionsInterModuleContract.methods.listDefinitionsByProject;
    expect(isInterModuleKnownError(method, error)).toBe(true);
    expect((error as {code: string}).code).toBe('project-workspace-mismatch');
    expect(mocks.listDefinitions).not.toHaveBeenCalled();
    expect(mocks.getLatestDefinitionSyncState).not.toHaveBeenCalled();
  });

  it('resolves a definition at a ref through the core method', async () => {
    const resolved = {
      workflow: {id: '00000000-0000-4000-8000-000000000002', configPath: CONFIG_PATH},
      commit: COMMIT,
      model: {
        version: 3,
        model: {kind: 'workflow', name: 'CI', triggers: [], jobs: [], dependencies: []},
      },
      sourceSnapshot: {content: 'name: CI', format: 'yaml'},
      triggers: {},
      warnings: [],
    };
    mocks.resolveDefinitionAtRef.mockResolvedValue(resolved);
    const controller = new AbortController();

    const result = await presentation().handlers.resolveDefinitionAtRef(
      {projectId: PROJECT_ID, ref: REF, configPath: CONFIG_PATH},
      {signal: controller.signal},
    );

    expect(result).toEqual(resolved);
    expect(mocks.resolveDefinitionAtRef).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        ref: REF,
        configPath: CONFIG_PATH,
        signal: controller.signal,
      }),
    );
  });

  it('maps every resolution domain error to its known error details', async () => {
    const method = definitionsInterModuleContract.methods.resolveDefinitionAtRef;
    const cases: Array<{
      code: DefinitionAtRefError['code'];
      details: Record<string, unknown>;
      expected: Record<string, unknown>;
    }> = [
      {
        code: 'project-not-found',
        details: {projectId: PROJECT_ID},
        expected: {projectId: PROJECT_ID},
      },
      {code: 'ref-not-found', details: {ref: REF}, expected: {ref: REF}},
      {code: 'ref-invalid', details: {ref: REF}, expected: {ref: REF}},
      {
        code: 'ref-moved',
        details: {ref: REF, expectedCommit: COMMIT},
        expected: {ref: REF, expectedCommit: COMMIT},
      },
      {
        code: 'file-not-found',
        details: {ref: REF, configPath: CONFIG_PATH},
        expected: {ref: REF, configPath: CONFIG_PATH},
      },
      {
        code: 'content-too-large',
        details: {configPath: CONFIG_PATH},
        expected: {configPath: CONFIG_PATH},
      },
      {
        code: 'invalid-definition',
        details: {errors: [{message: 'Invalid YAML', path: 'jobs'}]},
        expected: {errors: [{message: 'Invalid YAML', path: 'jobs'}]},
      },
      {code: 'source-unavailable', details: {}, expected: {}},
    ];

    for (const {code, details, expected} of cases) {
      mocks.resolveDefinitionAtRef.mockRejectedValueOnce(
        new DefinitionAtRefError(code, `boom: ${code}`, details),
      );
      const error = await rejection(
        presentation().handlers.resolveDefinitionAtRef(
          {projectId: PROJECT_ID, ref: REF, configPath: CONFIG_PATH},
          {signal: new AbortController().signal},
        ),
      );
      expect(isInterModuleKnownError(method, error)).toBe(true);
      expect((error as {code: string}).code).toBe(code);
      expect((error as {details: unknown}).details).toEqual(expected);
    }
  });

  it('re-throws unknown errors without mapping them', async () => {
    const boom = new Error('unexpected');
    mocks.resolveDefinitionAtRef.mockRejectedValue(boom);
    const error = await rejection(
      presentation().handlers.resolveDefinitionAtRef(
        {projectId: PROJECT_ID, ref: REF, configPath: CONFIG_PATH},
        {signal: new AbortController().signal},
      ),
    );
    expect(error).toBe(boom);
  });

  it('lists definitions at a ref with only the declared listing errors', async () => {
    const method = definitionsInterModuleContract.methods.listDefinitionsAtRef;
    mocks.listDefinitionsAtRef.mockRejectedValueOnce(
      new DefinitionAtRefError('ref-not-found', 'boom', {ref: REF}),
    );
    const error = await rejection(
      presentation().handlers.listDefinitionsAtRef(
        {projectId: PROJECT_ID, ref: REF},
        {signal: new AbortController().signal},
      ),
    );
    expect(isInterModuleKnownError(method, error)).toBe(true);
    expect((error as {code: string}).code).toBe('ref-not-found');
  });

  it('maps the listing file-limit failure to its known error', async () => {
    const method = definitionsInterModuleContract.methods.listDefinitionsAtRef;
    mocks.listDefinitionsAtRef.mockRejectedValueOnce(
      new DefinitionAtRefError('too-many-files', 'too many files', {fileCount: 100}),
    );

    const error = await rejection(
      presentation().handlers.listDefinitionsAtRef(
        {projectId: PROJECT_ID, ref: REF},
        {signal: new AbortController().signal},
      ),
    );

    expect(isInterModuleKnownError(method, error)).toBe(true);
    expect((error as {code: string}).code).toBe('too-many-files');
    expect((error as {details: unknown}).details).toEqual({fileCount: 100});
  });
});
