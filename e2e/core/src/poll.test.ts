import {PollTimeoutError, pollUntil} from './poll.js';

describe('pollUntil', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('polls until the probe returns a value', async () => {
    let calls = 0;

    const result = await pollUntil(
      {
        describe: () => 'resource to appear',
        intervalMs: 1,
        timeoutMs: 100,
      },
      () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? null : 'ready');
      },
    );

    expect(result).toBe('ready');
    expect(calls).toBe(2);
  });

  test('applies a custom backoff factor to the delay cadence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const callTimes: number[] = [];

    const result = pollUntil(
      {
        backoffFactor: 1.5,
        describe: () => 'resource to appear',
        intervalMs: 10,
        maxIntervalMs: 100,
        timeoutMs: 100,
      },
      () => {
        callTimes.push(Date.now());
        return Promise.resolve(callTimes.length === 4 ? 'ready' : null);
      },
    );

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(15);
    await vi.advanceTimersByTimeAsync(23);

    await expect(result).resolves.toBe('ready');
    expect(callTimes).toEqual([0, 10, 25, 48]);
  });

  test('clamps backoff factors below one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const callTimes: number[] = [];

    const result = pollUntil(
      {
        backoffFactor: 0,
        describe: () => 'resource to appear',
        intervalMs: 10,
        maxIntervalMs: 100,
        timeoutMs: 100,
      },
      () => {
        callTimes.push(Date.now());
        return Promise.resolve(callTimes.length === 4 ? 'ready' : null);
      },
    );

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBe('ready');
    expect(callTimes).toEqual([0, 10, 20, 30]);
  });

  test('times out with the description and last probe error', async () => {
    const result = pollUntil(
      {
        describe: () => 'resource to appear',
        timeoutMs: 0,
      },
      () => Promise.reject(new Error('not yet')),
    );

    await expect(result).rejects.toBeInstanceOf(PollTimeoutError);
    await expect(result).rejects.toMatchObject({
      timeoutMs: 0,
      description: 'resource to appear',
      lastError: new Error('not yet'),
    });
  });

  test('stops when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = pollUntil(
      {
        describe: () => 'resource to appear',
        signal: controller.signal,
        timeoutMs: 100,
      },
      () => Promise.resolve('ready'),
    );

    await expect(result).rejects.toThrow('Stopped waiting for resource to appear');
  });

  test('stops when the abort signal fires during the sleep interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const controller = new AbortController();
    let calls = 0;

    const result = pollUntil(
      {
        describe: () => 'resource to appear',
        intervalMs: 50,
        signal: controller.signal,
        timeoutMs: 100,
      },
      () => {
        calls += 1;
        return Promise.resolve(null);
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    const rejection = expect(result).rejects.toThrow('Stopped waiting for resource to appear');
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    await rejection;
    expect(calls).toBe(1);
  });
});
