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

  test('requires createdAt on non-empty annotation reads and keeps the cursor nullable', () => {
    const output = annotationsInterModuleContract.methods.listAnnotationsForRunAttempt.output.parse(
      {
        annotations: [
          {
            id: '00000000-0000-4000-8000-000000000004',
            job_id: '00000000-0000-4000-8000-000000000005',
            job_execution_id: '00000000-0000-4000-8000-000000000006',
            origin_step_id: '00000000-0000-4000-8000-000000000007',
            origin_step_attempt: 1,
            context: 'agent',
            style: 'info',
            sequence: 12,
            body: 'annotation',
            createdAt: '2026-08-31T12:00:00.000Z',
          },
        ],
        hasMore: false,
        nextCursor: null,
      },
    );

    expect(output).toEqual({
      annotations: [expect.objectContaining({createdAt: '2026-08-31T12:00:00.000Z'})],
      hasMore: false,
      nextCursor: null,
    });
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
