import type {JobPayloadDto} from '@shipfox/api-runners-dto';

vi.mock('#run-step.js', () => ({
  executeRunStep: vi.fn(),
}));

import {executeJob} from '#executor.js';
import {executeRunStep} from '#run-step.js';

const mockExecuteRunStep = vi.mocked(executeRunStep);

describe('executeJob', () => {
  beforeEach(() => {
    mockExecuteRunStep.mockReset();
  });

  it('executes steps in position order', async () => {
    const callOrder: number[] = [];
    mockExecuteRunStep.mockImplementation((step) => {
      callOrder.push(step.position);
      return Promise.resolve({success: true, output: ''});
    });

    const job = buildJob([
      {position: 2, name: 'second'},
      {position: 0, name: 'first'},
      {position: 1, name: 'middle'},
    ]);

    await executeJob(job);

    expect(callOrder).toEqual([0, 1, 2]);
  });

  it('returns succeeded when all steps pass', async () => {
    mockExecuteRunStep.mockResolvedValue({success: true, output: 'ok\n'});

    const job = buildJob([{position: 0}, {position: 1}]);

    const result = await executeJob(job);

    expect(result.status).toBe('succeeded');
    expect(result.output).toBe('ok\nok\n');
  });

  it('stops on first failure and returns failed', async () => {
    mockExecuteRunStep
      .mockResolvedValueOnce({success: true, output: 'step1\n'})
      .mockResolvedValueOnce({success: false, output: 'step2-err\n'})
      .mockResolvedValueOnce({success: true, output: 'step3\n'});

    const job = buildJob([{position: 0}, {position: 1}, {position: 2}]);

    const result = await executeJob(job);

    expect(result.status).toBe('failed');
    expect(result.output).toBe('step1\nstep2-err\n');
    expect(mockExecuteRunStep).toHaveBeenCalledTimes(2);
  });

  it('handles a single step job', async () => {
    mockExecuteRunStep.mockResolvedValue({success: true, output: 'done\n'});

    const job = buildJob([{position: 0}]);

    const result = await executeJob(job);

    expect(result.status).toBe('succeeded');
    expect(result.output).toBe('done\n');
  });

  it('handles a job with no steps', async () => {
    const job = buildJob([]);

    const result = await executeJob(job);

    expect(result.status).toBe('succeeded');
    expect(result.output).toBe('');
    expect(mockExecuteRunStep).not.toHaveBeenCalled();
  });
});

function buildJob(steps: Array<{position: number; name?: string}>): JobPayloadDto {
  return {
    job_id: '00000000-0000-0000-0000-000000000001',
    run_id: '00000000-0000-0000-0000-000000000002',
    job_name: 'test-job',
    steps: steps.map((s, i) => ({
      id: `00000000-0000-0000-0000-00000000000${i}`,
      name: s.name ?? null,
      type: 'run',
      config: {run: 'echo test'},
      position: s.position,
    })),
  };
}
