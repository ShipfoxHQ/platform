import {waitForRunObservationMatching} from './polling.js';

const runId = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-07-04T10:00:00.000Z';

function response(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

function head() {
  return {
    current_attempt: 1,
    latest_attempt: 1,
    current_status: 'succeeded',
    updated_at: timestamp,
  };
}

function overview() {
  return {
    run: {
      id: runId,
      project_id: '11111111-1111-4111-8111-111111111111',
      definition_id: '22222222-2222-4222-8222-222222222222',
      number: 1,
      name: 'Build',
      workflow_name: 'Build',
      origin: 'synced',
      dev_source: null,
      trigger_provider: 'manual',
      trigger_source: 'manual',
      trigger_event: 'manual',
      trigger_reference: null,
      created_at: timestamp,
    },
    attempt: {
      id: '44444444-4444-4444-8444-444444444444',
      workflow_run_id: runId,
      attempt: 1,
      status: 'succeeded',
      created_at: timestamp,
      started_at: timestamp,
      finished_at: timestamp,
      rerun_mode: null,
    },
    has_started_job_execution: true,
    jobs: {kind: 'complete', total: 0, items: []},
  };
}

describe('waitForRunObservationMatching', () => {
  test('retries a run that is not visible yet', async () => {
    let calls = 0;
    const result = await waitForRunObservationMatching({
      fetch: (input) => {
        calls += 1;
        if (calls === 1) return response({code: 'not-found'}, {status: 404});
        const url = new URL(input);
        return url.pathname.endsWith('/head') ? response(head()) : response(overview());
      },
      runId,
      timeoutMs: 1_000,
      description: 'workflow observation',
      matches: (observation) => ({
        matched: observation.status === 'succeeded',
        diagnostic: `status=${observation.status}`,
      }),
      token: 'user-token',
    });

    expect(result.status).toBe('succeeded');
    expect(calls).toBe(3);
  });

  test('rethrows non-transient API failures', async () => {
    const result = waitForRunObservationMatching({
      fetch: () => response({code: 'server-error'}, {status: 500}),
      runId,
      timeoutMs: 1_000,
      description: 'workflow observation',
      matches: () => ({matched: false, diagnostic: 'not matched'}),
      token: 'user-token',
    });

    await expect(result).rejects.toMatchObject({
      name: 'E2eApiError',
      status: 500,
    });
  });
});
