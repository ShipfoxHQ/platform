import {annotationsInterModuleContract} from './inter-module.js';

describe('annotationsInterModuleContract', () => {
  test('accepts a workspace-scoped annotation read with a decoded cursor', () => {
    const input = annotationsInterModuleContract.methods.listAnnotationsForRunAttempt.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      workflowRunId: '00000000-0000-4000-8000-000000000002',
      workflowRunAttempt: 2,
      jobExecutionId: '00000000-0000-4000-8000-000000000003',
      cursor: {value: 12, id: '00000000-0000-4000-8000-000000000004'},
      limit: 50,
    });

    expect(input.workflowRunAttempt).toBe(2);
    expect(input.cursor).toEqual({
      value: 12,
      id: '00000000-0000-4000-8000-000000000004',
    });
  });

  test('keeps an empty annotation read result nullable only at the cursor', () => {
    const output = annotationsInterModuleContract.methods.listAnnotationsForRunAttempt.output.parse(
      {annotations: [], hasMore: false, nextCursor: null},
    );

    expect(output).toEqual({annotations: [], hasMore: false, nextCursor: null});
    expect(
      annotationsInterModuleContract.methods.listAnnotationsForRunAttempt.input.safeParse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        workflowRunId: '00000000-0000-4000-8000-000000000002',
        workflowRunAttempt: 1,
        limit: 501,
      }).success,
    ).toBe(false);
  });
});
