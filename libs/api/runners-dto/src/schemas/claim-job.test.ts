import {claimedJobResponseSchema} from './claim-job.js';

describe('claimedJobResponseSchema', () => {
  it('parses a step-less claim response', () => {
    const parsed = claimedJobResponseSchema.parse({
      job_id: crypto.randomUUID(),
      job_execution_id: crypto.randomUUID(),
      workflow_run_id: crypto.randomUUID(),
      workflow_run_attempt_id: crypto.randomUUID(),
      lease_token: 'lease-abc',
    });

    expect(parsed.lease_token).toBe('lease-abc');
    expect(parsed.isolation_timeout_seconds).toBeUndefined();
  });

  it('parses the negotiated isolation timeout', () => {
    const parsed = claimedJobResponseSchema.parse({
      job_id: crypto.randomUUID(),
      job_execution_id: crypto.randomUUID(),
      workflow_run_id: crypto.randomUUID(),
      workflow_run_attempt_id: crypto.randomUUID(),
      lease_token: 'lease-abc',
      isolation_timeout_seconds: 300,
    });

    expect(parsed.isolation_timeout_seconds).toBe(300);
  });

  it('rejects a missing lease token', () => {
    const parse = () =>
      claimedJobResponseSchema.parse({
        job_id: crypto.randomUUID(),
        job_execution_id: crypto.randomUUID(),
        workflow_run_id: crypto.randomUUID(),
        workflow_run_attempt_id: crypto.randomUUID(),
      });

    expect(parse).toThrow();
  });

  it('rejects an empty lease token', () => {
    const parse = () =>
      claimedJobResponseSchema.parse({
        job_id: crypto.randomUUID(),
        job_execution_id: crypto.randomUUID(),
        workflow_run_id: crypto.randomUUID(),
        workflow_run_attempt_id: crypto.randomUUID(),
        lease_token: '',
      });

    expect(parse).toThrow();
  });

  it('rejects a non-uuid job id', () => {
    const parse = () =>
      claimedJobResponseSchema.parse({
        job_id: 'not-a-uuid',
        job_execution_id: crypto.randomUUID(),
        workflow_run_id: crypto.randomUUID(),
        workflow_run_attempt_id: crypto.randomUUID(),
        lease_token: 'lease-abc',
      });

    expect(parse).toThrow();
  });
});
