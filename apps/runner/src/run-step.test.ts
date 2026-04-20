import {executeRunStep} from '#run-step.js';

describe('executeRunStep', () => {
  it('succeeds with exit code 0', async () => {
    const step = buildStep({config: {run: 'echo hello'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('fails with non-zero exit code', async () => {
    const step = buildStep({config: {run: 'exit 1'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
  });

  it('captures both stdout and stderr', async () => {
    const step = buildStep({config: {run: 'echo out && echo err >&2'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });

  it('returns failure for unsupported step type', async () => {
    const step = buildStep({type: 'docker', config: {image: 'node:20'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.output).toContain('Unsupported step type: docker');
  });

  it('returns failure when config.run is missing', async () => {
    const step = buildStep({config: {}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.output).toContain('missing or empty');
  });

  it('handles multi-line scripts', async () => {
    const step = buildStep({
      config: {run: 'echo first\necho second'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('first');
    expect(result.output).toContain('second');
  });

  it('fails on first error with pipefail', async () => {
    const step = buildStep({
      config: {run: 'false | echo piped'},
    });

    const result = await executeRunStep(step);

    // With -eo pipefail, the false in the pipe causes failure
    expect(result.success).toBe(false);
  });
});

function buildStep(
  overrides: Partial<{type: string; name: string | null; config: Record<string, unknown>}> = {},
) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: overrides.name ?? 'test-step',
    type: overrides.type ?? 'run',
    config: overrides.config ?? {run: 'echo test'},
    position: 0,
  };
}
