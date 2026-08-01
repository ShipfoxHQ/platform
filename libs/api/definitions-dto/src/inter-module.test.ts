import {definitionsInterModuleContract} from './inter-module.js';
import {readPersistedWorkflowModel} from './workflow-model.js';

describe('definitionsInterModuleContract', () => {
  test('exposes a versioned workflow snapshot', () => {
    const result = definitionsInterModuleContract.methods.getDefinitionForWorkflowRun.output.parse({
      definition: {
        id: '00000000-0000-4000-8000-000000000001',
        projectId: '00000000-0000-4000-8000-000000000002',
        name: 'Deploy',
        model: {version: 2, model: {kind: 'workflow'}},
        sourceSnapshot: null,
      },
    });

    expect(result.definition?.model.version).toBe(2);
  });

  test('rejects an unknown persisted snapshot version', () => {
    expect(() =>
      readPersistedWorkflowModel({version: 1, model: {kind: 'workflow'}} as never),
    ).toThrow();
  });
});
