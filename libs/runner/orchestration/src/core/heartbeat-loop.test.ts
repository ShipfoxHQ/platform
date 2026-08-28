import {HTTPError} from 'ky';

const heartbeatMock = vi.fn();

vi.mock('@shipfox/runner-protocol', () => ({
  heartbeat: (
    jobId: string,
    leaseToken: string,
    opts?: {signal?: AbortSignal; capabilities?: unknown},
  ) => heartbeatMock(jobId, leaseToken, opts),
  HTTPError,
}));

const {startHeartbeatLoop} = await import('#core/heartbeat-loop.js');

beforeEach(() => {
  heartbeatMock.mockReset();
  vi.useFakeTimers();
});

function buildHTTPError(status: number): HTTPError {
  // Construct a minimal Response object: ky's HTTPError just reads .response.status
  const response = {status} as Response;
  const request = {} as Request;
  const options = {} as ConstructorParameters<typeof HTTPError>[2];
  return new HTTPError(response, request, options);
}

describe('startHeartbeatLoop', () => {
  test('schedules first tick at intervalMs and calls heartbeat with the job id', async () => {
    heartbeatMock.mockResolvedValue({cancel: false, lease_token: 'lease-1'});
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
    });

    // Flush any pending microtasks before asserting the timer has not fired.
    // a regression that resolved the first tick synchronously would leak past
    // an immediate `expect` without this.
    await Promise.resolve();
    expect(heartbeatMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock.mock.calls[0]?.[0]).toBe('job-1');
    expect(heartbeatMock.mock.calls[0]?.[1]).toBe('lease-1');
    expect(ac.signal.aborted).toBe(false);
    expect(handle.bumpGeneration).toEqual(expect.any(Function));

    handle.stop();
  });

  test('passes advertised tool capabilities to heartbeat', async () => {
    const capabilities = {harnesses: {pi: {tools: ['read']}}};
    heartbeatMock.mockResolvedValue({cancel: false, lease_token: 'lease-1'});
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      getToolCapabilities: () => capabilities,
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(heartbeatMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({capabilities, signal: expect.any(AbortSignal)}),
    );

    handle.stop();
  });

  test('single-flight: does not start a second tick until the first heartbeat resolves', async () => {
    let resolve: ((v: {cancel: boolean; lease_token: string}) => void) | undefined;
    heartbeatMock.mockImplementation(
      () => new Promise<{cancel: boolean; lease_token: string}>((r) => (resolve = r)),
    );
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    resolve?.({cancel: false, lease_token: 'lease-1'});
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  test('uses the renewed lease token on the next heartbeat tick', async () => {
    const renewedTokens: string[] = [];
    let leaseToken = 'lease-1';
    heartbeatMock
      .mockResolvedValueOnce({cancel: false, lease_token: 'lease-2'})
      .mockResolvedValueOnce({cancel: false, lease_token: 'lease-3'});
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => leaseToken, ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      onLeaseTokenRenewed: (renewedLeaseToken) => {
        renewedTokens.push(renewedLeaseToken);
        leaseToken = renewedLeaseToken;
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(heartbeatMock.mock.calls.map((call) => call[1])).toEqual(['lease-1', 'lease-2']);
    expect(renewedTokens).toEqual(['lease-2', 'lease-3']);

    handle.stop();
  });

  test('discards a stale renewal when the generation changes while heartbeat is in flight', async () => {
    let resolve: ((v: {cancel: boolean; lease_token: string}) => void) | undefined;
    const renewedTokens: string[] = [];
    heartbeatMock.mockImplementation(
      () => new Promise<{cancel: boolean; lease_token: string}>((r) => (resolve = r)),
    );
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-step-b', ac, {
      intervalMs: 100,
      maxStaleMs: 10_000,
      onLeaseTokenRenewed: (leaseToken) => renewedTokens.push(leaseToken),
    });

    await vi.advanceTimersByTimeAsync(100);
    handle.bumpGeneration();
    resolve?.({cancel: false, lease_token: 'lease-step-a-renewed'});
    await Promise.resolve();

    expect(renewedTokens).toEqual([]);

    handle.stop();
  });

  test('max-stale guard aborts the in-flight call and schedules the next tick', async () => {
    let receivedSignal: AbortSignal | undefined;
    heartbeatMock.mockImplementation(
      (
        _jobId: string,
        _leaseToken: string,
        opts?: {signal?: AbortSignal; capabilities?: unknown},
      ) =>
        new Promise<{cancel: boolean; lease_token: string}>((_resolve, reject) => {
          receivedSignal = opts?.signal;
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 200,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(receivedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    expect(receivedSignal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(2);

    // Job's own AbortController is NOT aborted (the heartbeat-level abort is internal).
    expect(ac.signal.aborted).toBe(false);

    handle.stop();
  });

  test('cancel:true aborts the job AbortController with the stop reason and stops the loop', async () => {
    heartbeatMock.mockResolvedValueOnce({
      cancel: true,
      cancellation_reason: 'timed_out',
      lease_token: 'lease-2',
    });
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      isolationTimeoutSeconds: 1,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(ac.signal.aborted).toBe(true);
    expect(ac.signal.reason).toBe('timed_out');

    await vi.advanceTimersByTimeAsync(1000);
    expect(ac.signal.reason).toBe('timed_out');
    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  test('HTTP 404 aborts the job AbortController and stops the loop', async () => {
    heartbeatMock.mockRejectedValueOnce(buildHTTPError(404));
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      isolationTimeoutSeconds: 1,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(ac.signal.aborted).toBe(true);
    expect(ac.signal.reason).toBe('orphaned');

    await vi.advanceTimersByTimeAsync(1000);
    expect(ac.signal.reason).toBe('orphaned');
    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  test('a transient failure does not stop a fenced job', async () => {
    heartbeatMock
      .mockRejectedValueOnce(buildHTTPError(500))
      .mockResolvedValueOnce({cancel: false, lease_token: 'lease-1'})
      .mockRejectedValue(buildHTTPError(500));
    const ac = new AbortController();
    const nowMs = vi.fn(() => Date.now());

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      isolationTimeoutSeconds: 1,
      nowMs,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(ac.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(899);
    expect(ac.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(ac.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ac.signal.reason).toBe('isolated');

    handle.stop();
  });

  test('stops local work at the isolation deadline after sustained heartbeat failures', async () => {
    heartbeatMock.mockRejectedValue(buildHTTPError(500));
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      isolationTimeoutSeconds: 1,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(ac.signal.aborted).toBe(true);
    expect(ac.signal.reason).toBe('isolated');
    handle.stop();
  });

  test('initial isolation fence waits for the first heartbeat interval', async () => {
    heartbeatMock.mockResolvedValue({cancel: false, lease_token: 'lease-1'});
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      isolationTimeoutSeconds: 0.01,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(heartbeatMock).not.toHaveBeenCalled();
    expect(ac.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(90);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(ac.signal.aborted).toBe(false);

    handle.stop();
  });

  test('successful confirmation resets the isolation deadline', async () => {
    heartbeatMock
      .mockResolvedValueOnce({cancel: false, lease_token: 'lease-1'})
      .mockImplementation(() => new Promise(() => undefined));
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
      isolationTimeoutSeconds: 1,
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(899);
    expect(ac.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ac.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(ac.signal.aborted).toBe(true);

    handle.stop();
  });

  test('stop() clears the isolation fence before its deadline', async () => {
    heartbeatMock.mockImplementation(() => new Promise(() => undefined));
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 10_000,
      isolationTimeoutSeconds: 1,
    });

    handle.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(ac.signal.aborted).toBe(false);
  });

  test('non-404 errors are transient: log and schedule next tick', async () => {
    heartbeatMock
      .mockRejectedValueOnce(buildHTTPError(500))
      .mockResolvedValueOnce({cancel: false, lease_token: 'lease-1'});
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(ac.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  test('stop() prevents future ticks and aborts any in-flight call', async () => {
    let aborted = false;
    heartbeatMock.mockImplementation(
      (
        _jobId: string,
        _leaseToken: string,
        opts?: {signal?: AbortSignal; capabilities?: unknown},
      ) =>
        new Promise<{cancel: boolean; lease_token: string}>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            aborted = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const ac = new AbortController();

    const handle = startHeartbeatLoop('job-1', () => 'lease-1', ac, {
      intervalMs: 100,
      maxStaleMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    handle.stop();
    expect(aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
  });
});
