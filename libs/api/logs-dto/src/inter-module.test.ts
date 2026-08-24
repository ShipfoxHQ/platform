import {logsInterModuleContract} from './inter-module.js';

describe('logsInterModuleContract', () => {
  test('accepts server-origin append commands', () => {
    const input = logsInterModuleContract.methods.appendServerRecords.input.parse({
      jobId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      projectId: '00000000-0000-4000-8000-000000000003',
      workflowRunAttemptId: '00000000-0000-4000-8000-000000000004',
      stepId: '00000000-0000-4000-8000-000000000005',
      attempt: 1,
      records: [
        {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'hello'},
        {v: 1, ts: 1, type: 'group_start', group_id: 'g1', parent_group_id: null, name: 'call'},
        {v: 1, ts: 1, type: 'group_end', group_id: 'g1'},
      ],
    });

    expect(input.attempt).toBe(1);
    expect(input.records).toHaveLength(3);
    expect(input.records[1]).toMatchObject({type: 'group_start'});
  });

  test('rejects records outside the stored union', () => {
    const result = logsInterModuleContract.methods.appendServerRecords.input.safeParse({
      jobId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      projectId: '00000000-0000-4000-8000-000000000003',
      workflowRunAttemptId: '00000000-0000-4000-8000-000000000004',
      stepId: '00000000-0000-4000-8000-000000000005',
      attempt: 1,
      records: [{v: 1, ts: 1, type: 'output', stream: 'stdout'}],
    });

    expect(result.success).toBe(false);
  });
});
