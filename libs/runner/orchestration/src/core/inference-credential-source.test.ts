vi.hoisted(() => {
  process.env.SHIPFOX_API_URL = 'https://api.test';
  process.env.SHIPFOX_RUNNER_LABELS = 'local';
  return {};
});

import type {
  AgentRuntimeConfigResponse,
  AgentRuntimeConfigResponseTiming,
} from '@shipfox/runner-protocol';
import {AgentRuntimeConfigRequestError} from '@shipfox/runner-protocol';
import {
  createInferenceCredentialSource,
  deriveMonotonicCredentialDeadlines,
  INFERENCE_CREDENTIAL_SAFETY_WINDOW_MS,
  InferenceCredentialIdentityMismatchError,
  InferenceCredentialProtocolError,
  InferenceCredentialSourceClosedError,
  InferenceCredentialUnavailableError,
  RenewableInferenceCredentialSource,
} from './inference-credential-source.js';

const SERVER_NOW = Date.parse('2026-09-03T12:00:00.000Z');
const SERVER_DATE = 'Thu, 03 Sep 2026 12:00:00 GMT';
const INITIAL_GENERATION = '11111111-1111-4111-8111-111111111111';
const SECOND_GENERATION = '22222222-2222-4222-8222-222222222222';
const THIRD_GENERATION = '33333333-3333-4333-8333-333333333333';
const FOURTH_GENERATION = '44444444-4444-4444-8444-444444444444';

describe('deriveMonotonicCredentialDeadlines', () => {
  it('anchors server-relative timestamps to the monotonic request start', () => {
    const deadlines = deriveMonotonicCredentialDeadlines(
      runtimeResponse().config,
      timing({requestStartedAt: 1_000, responseReceivedAt: 2_000}),
    );

    expect(deadlines).toEqual({
      refreshAt: 121_000,
      expiresAt: 301_000,
      clockSource: 'server-date',
    });
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-date'],
  ] as const)('uses the conservative local-clock fallback for a %s Date header', (_name, date) => {
    const fallbackReasons: string[] = [];
    const deadlines = deriveMonotonicCredentialDeadlines(
      runtimeResponse().config,
      timing({requestStartedAt: 1_000, responseReceivedAt: 2_000, serverDate: date}),
      {
        // The receipt sample, rather than a later local read, anchors the fallback.
        wallClockNow: () => SERVER_NOW + 600_000,
        onClockFallback: (reason) => fallbackReasons.push(reason),
      },
    );

    expect(deadlines).toEqual({
      refreshAt: 92_000,
      expiresAt: 272_000,
      clockSource: 'local-fallback',
    });
    expect(fallbackReasons).toEqual([_name]);
  });

  it('rejects an invalid renewal window', () => {
    expect(() =>
      deriveMonotonicCredentialDeadlines(
        runtimeResponse({
          expires_at: '2026-09-03T12:01:00.000Z',
          renewal: {mode: 'refresh-at', refresh_at: '2026-09-03T12:02:00.000Z'},
        }).config,
        timing(),
      ),
    ).toThrow(InferenceCredentialProtocolError);
  });

  it('rejects impossible calendar timestamps instead of accepting Date.parse normalization', () => {
    expect(() =>
      deriveMonotonicCredentialDeadlines(
        runtimeResponse({
          expires_at: '2026-03-03T12:00:00.000Z',
          renewal: {mode: 'refresh-at', refresh_at: '2026-02-30T11:55:00.000Z'},
        }).config,
        timing(),
      ),
    ).toThrow(InferenceCredentialProtocolError);
  });
});

describe('RenewableInferenceCredentialSource', () => {
  let now: number;
  let fetchRuntimeConfig: ReturnType<typeof vi.fn>;
  let replacements: string[][];

  beforeEach(() => {
    now = 1_000;
    fetchRuntimeConfig = vi.fn();
    replacements = [];
  });

  function source(
    initial: AgentRuntimeConfigResponse = runtimeResponse(),
    options: Partial<{
      signal: AbortSignal;
      refreshAttempts: number;
      refreshTimeoutMs: number;
    }> = {},
  ): RenewableInferenceCredentialSource {
    const created = createInferenceCredentialSource({
      initial,
      signal: options.signal ?? new AbortController().signal,
      fetchRuntimeConfig: fetchRuntimeConfig as never,
      replaceInferenceSecrets: (secrets) => replacements.push([...secrets]),
      monotonicNow: () => now,
      wallClockNow: () => SERVER_NOW,
      refreshAttempts: options.refreshAttempts ?? 1,
      refreshTimeoutMs: options.refreshTimeoutMs ?? 100,
    });
    expect(created).toBeInstanceOf(RenewableInferenceCredentialSource);
    return created as RenewableInferenceCredentialSource;
  }

  it('returns the initial credential before the refresh deadline', async () => {
    const credentialSource = source();

    await expect(credentialSource.resolve()).resolves.toEqual({
      token: 'token-1',
      generation: INITIAL_GENERATION,
    });
    expect(fetchRuntimeConfig).not.toHaveBeenCalled();
    expect(replacements).toEqual([['token-1']]);
  });

  it('refreshes after the monotonic refresh deadline and rotates redaction secrets', async () => {
    now = 121_000;
    fetchRuntimeConfig.mockResolvedValue(
      runtimeResponse({
        credentials: {api_key: 'token-2'},
        generation: SECOND_GENERATION,
      }),
    );
    const credentialSource = source();

    await expect(credentialSource.resolve()).resolves.toEqual({
      token: 'token-2',
      generation: SECOND_GENERATION,
    });
    expect(fetchRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(replacements).toEqual([['token-1'], ['token-2', 'token-1']]);
  });

  it('does not accept a generation that was already retired', async () => {
    now = 121_000;
    fetchRuntimeConfig.mockResolvedValueOnce(
      runtimeResponse({
        credentials: {api_key: 'token-2'},
        generation: SECOND_GENERATION,
      }),
    );
    const credentialSource = source();
    await expect(credentialSource.resolve()).resolves.toEqual({
      token: 'token-2',
      generation: SECOND_GENERATION,
    });

    now = 241_000;
    fetchRuntimeConfig.mockResolvedValueOnce(runtimeResponse({generation: INITIAL_GENERATION}));
    await expect(
      credentialSource.resolve({rejectedGeneration: SECOND_GENERATION}),
    ).rejects.toBeInstanceOf(InferenceCredentialProtocolError);
    expect(replacements).toEqual([['token-1'], ['token-2', 'token-1']]);
  });

  it('shares one refresh flight between concurrent resolutions', async () => {
    now = 121_000;
    let resolveRefresh: (response: AgentRuntimeConfigResponse) => void = () => undefined;
    fetchRuntimeConfig.mockImplementation(
      () =>
        new Promise<AgentRuntimeConfigResponse>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const credentialSource = source();

    const first = credentialSource.resolve();
    const second = credentialSource.resolve();
    await Promise.resolve();
    expect(fetchRuntimeConfig).toHaveBeenCalledTimes(1);

    resolveRefresh(
      runtimeResponse({
        credentials: {api_key: 'token-2'},
        generation: SECOND_GENERATION,
      }),
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      {token: 'token-2', generation: SECOND_GENERATION},
      {token: 'token-2', generation: SECOND_GENERATION},
    ]);
  });

  it('forces refresh for a matching rejection and ignores a stale rejection', async () => {
    fetchRuntimeConfig.mockResolvedValue(
      runtimeResponse({
        credentials: {api_key: 'token-2'},
        generation: SECOND_GENERATION,
      }),
    );
    const credentialSource = source();

    await expect(
      credentialSource.resolve({rejectedGeneration: INITIAL_GENERATION}),
    ).resolves.toEqual({token: 'token-2', generation: SECOND_GENERATION});
    expect(fetchRuntimeConfig).toHaveBeenCalledTimes(1);
    fetchRuntimeConfig.mockClear();

    await expect(
      credentialSource.resolve({rejectedGeneration: INITIAL_GENERATION}),
    ).resolves.toEqual({token: 'token-2', generation: SECOND_GENERATION});
    expect(fetchRuntimeConfig).not.toHaveBeenCalled();
  });

  it('returns the current safe credential after transient refresh failure', async () => {
    now = 121_000;
    fetchRuntimeConfig.mockRejectedValue(new TypeError('network unavailable'));
    const credentialSource = source();

    await expect(credentialSource.resolve()).resolves.toEqual({
      token: 'token-1',
      generation: INITIAL_GENERATION,
    });
    expect(replacements).toEqual([['token-1']]);
  });

  it('does not hide a denied renewal behind the current credential', async () => {
    now = 121_000;
    const denied = new AgentRuntimeConfigRequestError(403, 'forbidden');
    fetchRuntimeConfig.mockRejectedValue(denied);
    const credentialSource = source();

    await expect(credentialSource.resolve()).rejects.toBe(denied);
  });

  it('retains the current safe credential after an invalid refresh payload', async () => {
    now = 121_000;
    fetchRuntimeConfig.mockRejectedValue(
      new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid'),
    );
    const credentialSource = source();

    await expect(credentialSource.resolve()).resolves.toEqual({
      token: 'token-1',
      generation: INITIAL_GENERATION,
    });
  });

  it('fails closed when a transient refresh leaves less than the safety window', async () => {
    now = 301_000 - INFERENCE_CREDENTIAL_SAFETY_WINDOW_MS + 1;
    fetchRuntimeConfig.mockRejectedValue(new TypeError('network unavailable'));
    const credentialSource = source();

    await expect(credentialSource.resolve()).rejects.toBeInstanceOf(
      InferenceCredentialUnavailableError,
    );
  });

  it('rejects runtime identity drift without replacing the current secret', async () => {
    now = 121_000;
    fetchRuntimeConfig.mockResolvedValue(
      runtimeResponse({
        model: 'different-model',
        credentials: {api_key: 'token-2'},
        generation: SECOND_GENERATION,
      }),
    );
    const credentialSource = source();

    await expect(credentialSource.resolve()).rejects.toBeInstanceOf(
      InferenceCredentialIdentityMismatchError,
    );
    expect(replacements).toEqual([['token-1']]);
  });

  it('retains only the current and previous two generations', async () => {
    const credentialSource = source();
    now = 121_000;
    fetchRuntimeConfig.mockResolvedValueOnce(
      runtimeResponse({
        credentials: {api_key: 'token-2'},
        generation: SECOND_GENERATION,
        expires_at: '2026-09-03T12:07:00.000Z',
        renewal: {mode: 'refresh-at', refresh_at: '2026-09-03T12:04:00.000Z'},
      }),
    );
    await credentialSource.resolve();
    now = 241_000;
    fetchRuntimeConfig.mockResolvedValueOnce(
      runtimeResponse({
        credentials: {api_key: 'token-3'},
        generation: THIRD_GENERATION,
        expires_at: '2026-09-03T12:09:00.000Z',
        renewal: {mode: 'refresh-at', refresh_at: '2026-09-03T12:06:00.000Z'},
      }),
    );
    await credentialSource.resolve();
    now = 361_000;
    fetchRuntimeConfig.mockResolvedValueOnce(
      runtimeResponse({
        credentials: {api_key: 'token-4'},
        generation: FOURTH_GENERATION,
        expires_at: '2026-09-03T12:11:00.000Z',
        renewal: {mode: 'refresh-at', refresh_at: '2026-09-03T12:08:00.000Z'},
      }),
    );
    await credentialSource.resolve();

    expect(replacements.at(-1)).toEqual(['token-4', 'token-3', 'token-2']);
    expect(replacements.at(-1)).not.toContain('token-1');
  });

  it('closes on the job abort and clears the inference secret registry', async () => {
    const controller = new AbortController();
    const credentialSource = source(runtimeResponse(), {signal: controller.signal});
    controller.abort();

    await expect(credentialSource.resolve()).rejects.toBeInstanceOf(
      InferenceCredentialSourceClosedError,
    );
    expect(replacements.at(-1)).toEqual([]);
  });

  it('closes immediately when constructed with an already-aborted job signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const credentialSource = source(runtimeResponse(), {signal: controller.signal});

    await expect(credentialSource.resolve()).rejects.toBeInstanceOf(
      InferenceCredentialSourceClosedError,
    );
    expect(replacements.at(-1)).toEqual([]);
  });

  it('aborts an in-flight refresh when explicitly closed', async () => {
    now = 121_000;
    let resolveRefresh: (response: AgentRuntimeConfigResponse) => void = () => undefined;
    let refreshSignal: AbortSignal | undefined;
    fetchRuntimeConfig.mockImplementation(
      ({signal}: {signal: AbortSignal}) =>
        new Promise<AgentRuntimeConfigResponse>((resolve) => {
          refreshSignal = signal;
          resolveRefresh = resolve;
        }),
    );
    const credentialSource = source();
    const resolution = credentialSource.resolve();
    await Promise.resolve();
    credentialSource.close();

    await expect(resolution).rejects.toBeInstanceOf(InferenceCredentialSourceClosedError);
    expect(refreshSignal?.aborted).toBe(true);
    expect(replacements.at(-1)).toEqual([]);
    resolveRefresh(runtimeResponse({generation: SECOND_GENERATION}));
  });

  it('does not create a source for static runtime credentials', () => {
    const created = createInferenceCredentialSource({
      initial: runtimeResponse({
        expires_at: undefined,
        generation: undefined,
        renewal: undefined,
      }),
      signal: new AbortController().signal,
      fetchRuntimeConfig: fetchRuntimeConfig as never,
    });

    expect(created).toBeUndefined();
  });

  it('leaves compatibility on-rejection credentials on the existing path', () => {
    const created = createInferenceCredentialSource({
      initial: runtimeResponse({renewal: {mode: 'on-rejection'}}),
      signal: new AbortController().signal,
      fetchRuntimeConfig: fetchRuntimeConfig as never,
      replaceInferenceSecrets: (secrets) => replacements.push([...secrets]),
    });

    expect(created).toBeUndefined();
    expect(replacements).toEqual([]);
  });
});

function runtimeResponse(
  overrides: Partial<AgentRuntimeConfigResponse['config']> = {},
): AgentRuntimeConfigResponse {
  return {
    config: {
      harness: 'pi',
      provider_id: 'shipfox',
      model: 'model-1',
      thinking: 'high',
      credentials: {api_key: 'token-1'},
      custom_provider: {
        api: 'anthropic-messages',
        base_url: 'https://gateway.example.test/v1',
        headers: [],
        secret_header_names: [],
        models: [{id: 'model-1', label: 'Model 1'}],
        requires_api_key: true,
      },
      expires_at: '2026-09-03T12:05:00.000Z',
      generation: INITIAL_GENERATION,
      renewal: {mode: 'refresh-at', refresh_at: '2026-09-03T12:02:00.000Z'},
      ...overrides,
    },
    timing: timing(),
  };
}

function timing(
  overrides: Partial<AgentRuntimeConfigResponseTiming> = {},
): AgentRuntimeConfigResponseTiming {
  return {
    requestStartedAt: 1_000,
    responseReceivedAt: 2_000,
    wallClockAtReceipt: SERVER_NOW,
    serverDate: SERVER_DATE,
    ...overrides,
  };
}
