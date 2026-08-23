import {definitionsInterModuleContract} from './inter-module.js';
import {readPersistedWorkflowModel} from './workflow-model.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const WORKFLOW_ID = '00000000-0000-4000-8000-000000000002';
const REF = 'refs/heads/main';
const CONFIG_PATH = '.shipfox/workflows/ci.yml';
const COMMIT = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const MODEL = {version: 2 as const, model: {kind: 'workflow'}};

describe('definitionsInterModuleContract', () => {
  test('exposes a versioned workflow snapshot', () => {
    const result = definitionsInterModuleContract.methods.getDefinitionForWorkflowRun.output.parse({
      definition: {
        id: '00000000-0000-4000-8000-000000000001',
        workflowId: '00000000-0000-4000-8000-000000000003',
        projectId: '00000000-0000-4000-8000-000000000002',
        name: 'Deploy',
        model: {version: 2, model: {kind: 'workflow'}},
        sourceSnapshot: null,
      },
    });

    expect(result.definition?.model.version).toBe(2);
    expect(result.definition?.workflowId).toBe('00000000-0000-4000-8000-000000000003');
  });

  test('rejects an unknown persisted snapshot version', () => {
    expect(() =>
      readPersistedWorkflowModel({version: 1, model: {kind: 'workflow'}} as never),
    ).toThrow();
  });

  test('parses at-ref inputs and outputs', () => {
    const resolve = definitionsInterModuleContract.methods.resolveDefinitionAtRef;
    const list = definitionsInterModuleContract.methods.listDefinitionsAtRef;

    expect(
      resolve.input.parse({
        projectId: PROJECT_ID,
        ref: REF,
        configPath: CONFIG_PATH,
        expectedCommit: COMMIT,
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      ref: REF,
      configPath: CONFIG_PATH,
      expectedCommit: COMMIT,
    });
    expect(list.input.parse({projectId: PROJECT_ID, ref: REF})).toEqual({
      projectId: PROJECT_ID,
      ref: REF,
    });

    expect(
      resolve.output.parse({
        workflow: {id: WORKFLOW_ID, configPath: CONFIG_PATH},
        commit: COMMIT,
        model: MODEL,
        sourceSnapshot: {content: 'name: CI', format: 'yaml'},
        triggers: {manual: {source: 'manual', event: 'fire'}},
        warnings: [{code: 'warning', message: 'Use a pinned runner', path: 'runner'}],
      }),
    ).toMatchObject({workflow: {id: WORKFLOW_ID}, commit: COMMIT});
    expect(
      list.output.parse({
        commit: COMMIT,
        files: [
          {
            configPath: CONFIG_PATH,
            name: 'CI',
            valid: true,
            errors: [],
            warnings: [{code: 'warning', message: 'Use a pinned runner'}],
            triggers: {manual: {source: 'manual', event: 'fire'}},
          },
        ],
      }),
    ).toMatchObject({commit: COMMIT, files: [{configPath: CONFIG_PATH, valid: true}]});
  });

  test.each([
    ['project-not-found', {projectId: PROJECT_ID}],
    ['ref-not-found', {ref: REF}],
    ['ref-invalid', {ref: REF}],
    ['ref-moved', {ref: REF, expectedCommit: COMMIT}],
    ['file-not-found', {ref: REF, configPath: CONFIG_PATH}],
    ['content-too-large', {configPath: CONFIG_PATH}],
    ['invalid-definition', {errors: [{message: 'Invalid YAML', path: 'jobs'}]}],
    ['source-unavailable', {}],
  ] as const)('defines the %s resolution error', (code, details) => {
    const method = definitionsInterModuleContract.methods.resolveDefinitionAtRef;
    const schema = method.errors[code as keyof typeof method.errors];

    expect(schema.parse(details)).toEqual(details);
  });

  test.each([
    ['project-not-found', {projectId: PROJECT_ID}],
    ['ref-not-found', {ref: REF}],
    ['ref-invalid', {ref: REF}],
    ['too-many-files', {}],
    ['source-unavailable', {}],
  ] as const)('defines the %s listing error', (code, details) => {
    const method = definitionsInterModuleContract.methods.listDefinitionsAtRef;
    const schema = method.errors[code as keyof typeof method.errors];

    expect(schema.parse(details)).toEqual(details);
  });
});
