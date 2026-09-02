import {
  AGENT_ACCESS_DEFAULT_PAGE_LIMIT,
  getRunAnnotationsInputSchema,
  getRunAnnotationsResultSchema,
  listProjectsInputSchema,
  listProjectsResultJsonSchema,
  listProjectsResultSchema,
  listTriggerEventsInputSchema,
  listWorkflowDefinitionsResultSchema,
  listWorkflowRunsInputSchema,
} from './paged-tools.js';

const projectId = '00000000-0000-4000-8000-000000000001';

describe('paged agent-access schemas', () => {
  test('defaults page size and rejects gateway-owned workspace arguments', () => {
    expect(listProjectsInputSchema.parse({})).toEqual({limit: AGENT_ACCESS_DEFAULT_PAGE_LIMIT});
    expect(listProjectsInputSchema.safeParse({workspace_id: projectId}).success).toBe(false);
  });

  test('validates date windows and strict list filters', () => {
    expect(
      listWorkflowRunsInputSchema.safeParse({
        project_id: projectId,
        created_from: '2026-08-02T00:00:00.000Z',
        created_to: '2026-08-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(listTriggerEventsInputSchema.safeParse({source: ['push'], extra: true}).success).toBe(
      false,
    );
  });

  test('keeps output schemas as one strict object envelope result', () => {
    expect(listProjectsResultJsonSchema).not.toHaveProperty('oneOf');
    expect(listProjectsResultJsonSchema.properties.projects).toBeDefined();
    expect(listProjectsResultSchema.safeParse({projects: [], next_cursor: null}).success).toBe(
      true,
    );
    expect(
      listProjectsResultSchema.safeParse({projects: [], next_cursor: null, workspace_id: projectId})
        .success,
    ).toBe(false);
  });

  test('requires annotation body truncation metadata to remain a boolean marker and byte count', () => {
    const valid = {
      id: projectId,
      origin_step_id: '00000000-0000-4000-8000-000000000002',
      origin_step_attempt: 1,
      job_execution_id: '00000000-0000-4000-8000-000000000003',
      sequence: 1,
      created_at: '2026-08-01T00:00:00.000Z',
      body: 'body',
    };
    expect(
      getRunAnnotationsResultSchema.safeParse({annotations: [valid], next_cursor: null}).success,
    ).toBe(true);
    expect(getRunAnnotationsInputSchema.safeParse({run_id: projectId, attempt: 0}).success).toBe(
      false,
    );
  });

  test('keeps definition sync error codes aligned with the producer enum', () => {
    const sync = {
      ref: null,
      status: 'failed' as const,
      last_sync_at: '2026-08-01T00:00:00.000Z',
      started_at: null,
      finished_at: '2026-08-01T00:00:00.000Z',
      last_error_code: 'provider-timeout',
      last_error_message: 'timed out',
      diagnostics: {error_count: 0, warning_count: 0, items: []},
    };
    expect(
      listWorkflowDefinitionsResultSchema.safeParse({definitions: [], sync, next_cursor: null})
        .success,
    ).toBe(true);
    expect(
      listWorkflowDefinitionsResultSchema.safeParse({
        definitions: [],
        sync: {...sync, last_error_code: 'untrusted-instruction'},
        next_cursor: null,
      }).success,
    ).toBe(false);
  });
});
