import {workflowRunDtoSchema, workflowSourceSnapshotSchema} from './workflow-run.js';

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
