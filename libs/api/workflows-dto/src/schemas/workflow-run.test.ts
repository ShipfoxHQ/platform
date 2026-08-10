import {
  WORKFLOW_RUN_JOB_PREVIEW_LIMIT,
  workflowRunDtoSchema,
  workflowRunListItemSchema,
  workflowSourceSnapshotSchema,
} from './workflow-run.js';

const baseRun = {
  id: '11111111-1111-4111-8111-111111111111',
  project_id: '22222222-2222-4222-8222-222222222222',
  definition_id: '33333333-3333-4333-8333-333333333333',
  number: 1,
  name: 'Build',
  workflow_name: 'Build',
  status: 'pending',
  source_run_id: null,
  root_run_id: null,
  attempt: 1,
  current_attempt: 1,
  latest_attempt: 1,
  rerun_mode: null,
  trigger_provider: null,
  trigger_source: 'manual',
  trigger_event: 'fire',
  trigger_payload: {source: 'manual', event: 'fire'},
  trigger_reference: null,
  inputs: null,
  created_at: '2026-06-16T00:00:00.000Z',
  updated_at: '2026-06-16T00:00:00.000Z',
  started_at: null,
  finished_at: null,
};

describe('workflow source snapshot schemas', () => {
  test('accepts YAML source snapshots', () => {
    const result = workflowSourceSnapshotSchema.parse({
      content: 'name: Build\njobs: {}\n',
      format: 'yaml',
    });

    expect(result).toEqual({content: 'name: Build\njobs: {}\n', format: 'yaml'});
  });

  test('rejects unsupported source snapshot formats', () => {
    const result = workflowSourceSnapshotSchema.safeParse({
      content: 'name = "Build"',
      format: 'toml',
    });

    expect(result.success).toBe(false);
  });

  test('accepts run DTOs with null source snapshots', () => {
    const result = workflowRunDtoSchema.parse({...baseRun, source_snapshot: null});

    expect(result.source_snapshot).toBeNull();
    expect(result.name).toBe('Build');
    expect(result.workflow_name).toBe('Build');
  });

  test('accepts run DTOs with source snapshots', () => {
    const result = workflowRunDtoSchema.parse({
      ...baseRun,
      source_snapshot: {content: 'name: Build\njobs: {}\n', format: 'yaml'},
    });

    expect(result.source_snapshot).toEqual({content: 'name: Build\njobs: {}\n', format: 'yaml'});
  });
});

describe('workflow run trigger reference schema', () => {
  test('accepts a partially resolved reference', () => {
    const result = workflowRunDtoSchema.parse({
      ...baseRun,
      source_snapshot: null,
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: null,
        actor: null,
      },
    });

    expect(result.trigger_reference).toEqual({
      repository: 'acme/api',
      ref: 'refs/heads/main',
      commit: null,
      actor: null,
    });
  });

  test('rejects a reference missing a field rather than defaulting it', () => {
    const result = workflowRunDtoSchema.safeParse({
      ...baseRun,
      source_snapshot: null,
      trigger_reference: {repository: 'acme/api', ref: 'refs/heads/main', commit: null},
    });

    expect(result.success).toBe(false);
  });
});

describe('workflow run list item schema', () => {
  function jobDto(position: number) {
    return {
      id: `44444444-4444-4444-8444-${String(position).padStart(12, '0')}`,
      key: `job-${position}`,
      name: null,
      status: 'succeeded' as const,
      mode: 'one_shot' as const,
      listener_status: 'inactive' as const,
      execution_status: null,
      position,
    };
  }

  test('carries job status glyphs alongside the run', () => {
    const result = workflowRunListItemSchema.parse({
      ...baseRun,
      source_snapshot: null,
      jobs: [jobDto(0)],
      job_status_counts: [{status: 'succeeded', count: 1}],
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.status).toBe('succeeded');
    expect(result.jobs[0]?.execution_status).toBeNull();
  });

  test('carries execution evidence and listening state for display derivation', () => {
    const result = workflowRunListItemSchema.parse({
      ...baseRun,
      source_snapshot: null,
      jobs: [
        {
          ...jobDto(0),
          mode: 'listening',
          listener_status: 'listening',
          execution_status: 'running',
        },
      ],
      job_status_counts: [{status: 'listening', count: 1}],
    });

    expect(result.jobs[0]).toMatchObject({
      mode: 'listening',
      listener_status: 'listening',
      execution_status: 'running',
    });
    expect(result.job_status_counts).toEqual([{status: 'listening', count: 1}]);
  });

  // The preview is a bounded slice, so counts describe jobs the payload never carried.
  test('accepts counts larger than the preview it ships', () => {
    const result = workflowRunListItemSchema.parse({
      ...baseRun,
      source_snapshot: null,
      jobs: [jobDto(0)],
      job_status_counts: [
        {status: 'succeeded', count: 40},
        {status: 'failed', count: 2},
      ],
    });

    expect(result.job_status_counts).toHaveLength(2);
  });

  test('rejects a preview longer than the documented bound', () => {
    const result = workflowRunListItemSchema.safeParse({
      ...baseRun,
      source_snapshot: null,
      jobs: Array.from({length: WORKFLOW_RUN_JOB_PREVIEW_LIMIT + 1}, (_, index) => jobDto(index)),
      job_status_counts: [],
    });

    expect(result.success).toBe(false);
  });

  test.each([
    ['a jobs array', {job_status_counts: []}],
    ['job status counts', {jobs: []}],
  ])('rejects a run list item without %s', (_missing, partial) => {
    const result = workflowRunListItemSchema.safeParse({
      ...baseRun,
      source_snapshot: null,
      ...partial,
    });

    expect(result.success).toBe(false);
  });
});
