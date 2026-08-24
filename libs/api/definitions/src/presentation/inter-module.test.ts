import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {DefinitionAtRefError} from '#core/errors.js';
import {createDefinitionsInterModulePresentation} from './inter-module.js';

const mocks = vi.hoisted(() => ({
  getDefinitionById: vi.fn(),
  listDefinitionsAtRef: vi.fn(),
  resolveDefinitionAtRef: vi.fn(),
}));

vi.mock('#db/definitions.js', () => ({
  getDefinitionById: mocks.getDefinitionById,
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
    projects: {} as never,
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
  });

  it('resolves a definition at a ref through the core method', async () => {
    const resolved = {
      workflow: {id: '00000000-0000-4000-8000-000000000002', configPath: CONFIG_PATH},
      commit: COMMIT,
      model: {
        version: 2,
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
