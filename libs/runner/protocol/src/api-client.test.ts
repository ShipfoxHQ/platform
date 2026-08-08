// Exercises the real api-client (the mocked step-loop tests can't) to prove registration,
// claim, heartbeat, and step calls use the right bearer token class. SHIPFOX_API_URL comes
// from test/env.ts (setupFiles), loaded before config is imported.

import {
  RUNNER_SESSION_EXHAUSTED_CODE,
  type RunnerToolCapabilitiesDto,
} from '@shipfox/api-runners-dto';
import {STEP_ERROR_MESSAGE_MAX_LENGTH, STEP_RESPONSE_MAX_LENGTH} from '@shipfox/api-workflows-dto';
import {
  AgentRuntimeConfigRequestError,
  appendStepLogs,
  createLeaseClient,
  enrollRunnerControlSession,
  exchangeRunnerBootstrapToken,
  HTTPError,
  heartbeat,
  heartbeatRunnerControlSession,
  pollRunnerAssignment,
  RunnerSessionExhaustedError,
  registerRunnerSession,
  reportStep,
  requestAgentRuntimeConfig,
  requestCheckoutToken,
  requestJob,
  requestNextStep,
  requestStepSecrets,
  requireRunnerLabels,
  StepSecretsRequestError,
  writeStepAnnotations,
} from '#api-client.js';
import {config} from '#config.js';

const JOB_ID = crypto.randomUUID();
const JOB_EXECUTION_ID = crypto.randomUUID();
const WORKFLOW_RUN_ID = crypto.randomUUID();
const WORKFLOW_RUN_ATTEMPT_ID = crypto.randomUUID();
const STEP_ID = crypto.randomUUID();
const SESSION_ID = crypto.randomUUID();
const ZOD_ERROR_TEXT_REGEX = /Zod|Invalid|Required/;
const TOOL_CAPABILITIES: RunnerToolCapabilitiesDto = {
  harnesses: {
    pi: {tools: ['read', 'bash']},
    claude: {tools: ['Read', 'Bash']},
  },
};

let calls: Array<{
  url: string;
  method: string;
  authorization: string | null;
  body: string;
  signal: AbortSignal;
}>;
let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runner labels', () => {
  it('canonicalizes configured labels', () => {
    const labels = requireRunnerLabels();

    expect(labels).toEqual(['linux', 'x64']);
  });

  it.each(['', ' , , '])('throws when SHIPFOX_RUNNER_LABELS is %j', async (labels) => {
    vi.stubEnv('SHIPFOX_RUNNER_LABELS', labels);
    vi.resetModules();

    const {
      requireRunnerLabels: loadLabels,
      RunnerLabelsRequiredError: LoadedRunnerLabelsRequiredError,
    } = await import('#api-client.js');

    expect(() => loadLabels()).toThrow(LoadedRunnerLabelsRequiredError);
  });
});

describe('api-client auth contexts', () => {
  it('exchanges a bootstrap token without granting job-plane authority', async () => {
    stubFetch(() =>
      jsonResponse({
        runner_instance_id: crypto.randomUUID(),
        control_session_token: 'control-token',
        expires_at: '2026-07-21T12:00:00.000Z',
      }),
    );

    const session = await exchangeRunnerBootstrapToken('bootstrap-token');

    expect(session).toEqual({controlSessionToken: 'control-token'});
    expect(calls[0]?.url).toContain('runner-enrollment/exchange');
    expect(calls[0]?.authorization).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({bootstrap_token: 'bootstrap-token'});
  });

  it('enrolls, heartbeats, and polls only with the control-session token', async () => {
    stubFetch(() => jsonResponse({activation_token: null}));

    const enrollmentActivationToken = await enrollRunnerControlSession({
      controlSessionToken: 'control-token',
      capabilities: TOOL_CAPABILITIES,
      providerKind: 'ec2',
      protocolVersion: '1',
    });

    expect(enrollmentActivationToken).toBeNull();
    expect(calls[0]?.url).toContain('runner-control/enrollment');
    expect(calls[0]?.authorization).toBe('Bearer control-token');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      labels: ['linux', 'x64'],
      capabilities: TOOL_CAPABILITIES,
      provider_kind: 'ec2',
      protocol_version: '1',
    });

    stubFetch(() => jsonResponse({ok: true}));
    await heartbeatRunnerControlSession('control-token');
    expect(calls[1]?.url).toContain('runner-control/heartbeat');
    expect(calls[1]?.authorization).toBe('Bearer control-token');

    stubFetch(() => jsonResponse({activation_token: 'activation-token'}));
    const activationToken = await pollRunnerAssignment('control-token');
    expect(activationToken).toBe('activation-token');
    expect(calls[2]?.url).toContain('runner-control/assignment');
    expect(calls[2]?.authorization).toBe('Bearer control-token');
  });

  it('uses the requested assignment wait for the query and transport timeout', async () => {
    vi.useFakeTimers();
    try {
      stubFetch(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(jsonResponse({activation_token: null})), 10_001),
          ),
      );

      const assignment = pollRunnerAssignment('control-token', undefined, {waitSeconds: 1});
      const expectation = expect(assignment).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(10_001);

      await expectation;
      expect(new URL(calls[0]?.url ?? '').searchParams.get('wait_seconds')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a transport timeout after the requested wait and buffer', async () => {
    vi.useFakeTimers();
    try {
      stubFetch(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(jsonResponse({activation_token: null})), 16_001),
          ),
      );

      const assignment = pollRunnerAssignment('control-token', undefined, {waitSeconds: 1});
      const expectation = expect(assignment).rejects.toMatchObject({name: 'TimeoutError'});
      await vi.advanceTimersByTimeAsync(16_001);

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('registerRunnerSession sends the registration token and configured labels', async () => {
    stubFetch(() => jsonResponse(registerResponse()));

    const session = await registerRunnerSession();

    expect(session).toEqual(registerResponse());
    expect(calls[0]?.url).toContain('runners/register');
    expect(calls[0]?.authorization).toBe(`Bearer ${config.SHIPFOX_RUNNER_REGISTRATION_TOKEN}`);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({labels: ['linux', 'x64']});
  });

  it('registerRunnerSession sends runner tool capabilities when provided', async () => {
    stubFetch(() => jsonResponse(registerResponse()));

    await registerRunnerSession({capabilities: TOOL_CAPABILITIES});

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      labels: ['linux', 'x64'],
      capabilities: TOOL_CAPABILITIES,
    });
  });

  it('requestJob sends the runner session token and parses the step-less claim + lease token', async () => {
    stubFetch(() => jsonResponse(claimResponse()));

    const job = await requestJob('session-abc');

    expect(job?.job_id).toBe(JOB_ID);
    expect(job?.job_execution_id).toBe(JOB_EXECUTION_ID);
    expect(job?.workflow_run_id).toBe(WORKFLOW_RUN_ID);
    expect(job?.workflow_run_attempt_id).toBe(WORKFLOW_RUN_ATTEMPT_ID);
    expect(job?.lease_token).toBe('lease-xyz');
    // The claim is step-less: no job_name / steps are required to parse.
    expect(job).not.toHaveProperty('steps');
    expect(job).not.toHaveProperty('job_name');
    expect(calls[0]?.url).toContain('runners/jobs/request');
    expect(calls[0]?.authorization).toBe('Bearer session-abc');
  });

  it('requestJob returns null on 204', async () => {
    stubFetch(() => new Response(null, {status: 204}));

    const job = await requestJob('session-abc');

    expect(job).toBeNull();
  });

  it('requestJob forwards the shutdown signal to the claim request', async () => {
    stubFetch(() => new Response(null, {status: 204}));
    const controller = new AbortController();

    await requestJob('session-abc', controller.signal);

    expect(calls[0]?.signal.aborted).toBe(false);
    controller.abort();
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it('requestJob treats the session-exhausted 409 code as terminal', async () => {
    stubFetch(() => jsonResponse({code: RUNNER_SESSION_EXHAUSTED_CODE}, 409));

    const request = requestJob('session-abc');

    await expect(request).rejects.toThrow(RunnerSessionExhaustedError);
  });

  it('requestJob rethrows non-terminal 409 responses as transient', async () => {
    stubFetch(() => jsonResponse({code: 'other-conflict'}, 409));

    const request = requestJob('session-abc');

    await expect(request).rejects.toThrow(HTTPError);
  });

  it('requestJob rethrows malformed 409 responses as transient', async () => {
    stubFetch(() => new Response('not json', {status: 409}));

    const request = requestJob('session-abc');

    await expect(request).rejects.toThrow(HTTPError);
  });

  it('heartbeat sends the job lease token', async () => {
    stubFetch(() => jsonResponse({cancel: false, lease_token: 'lease-next'}));

    const response = await heartbeat(JOB_ID, 'lease-heartbeat');

    expect(response.lease_token).toBe('lease-next');
    expect(calls[0]?.url).toContain(`runners/jobs/${JOB_ID}/heartbeat`);
    expect(calls[0]?.authorization).toBe('Bearer lease-heartbeat');
  });

  it('heartbeat sends runner tool capabilities when provided', async () => {
    stubFetch(() => jsonResponse({cancel: false, lease_token: 'lease-next'}));

    await heartbeat(JOB_ID, 'lease-heartbeat', {capabilities: TOOL_CAPABILITIES});

    expect(calls[0]?.url).toContain(`runners/jobs/${JOB_ID}/heartbeat`);
    expect(calls[0]?.authorization).toBe('Bearer lease-heartbeat');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({capabilities: TOOL_CAPABILITIES});
  });

  it('requestNextStep sends the lease token, not the runner registration token', async () => {
    stubFetch(() => jsonResponse({kind: 'done', status: 'succeeded'}));
    const leaseClient = createLeaseClient('lease-abc');

    const next = await requestNextStep(leaseClient);

    expect(next).toEqual({kind: 'done', status: 'succeeded'});
    expect(calls[0]?.url).toContain('runs/jobs/current/steps/next');
    expect(calls[0]?.authorization).toBe('Bearer lease-abc');
  });

  it('requestNextStep parses the step-scoped lease token on step responses', async () => {
    const step = {
      id: STEP_ID,
      job_execution_id: JOB_EXECUTION_ID,
      key: 'test-step',
      name: 'Test step',
      source_location: null,
      status: 'running',
      status_reason: null,
      type: 'run',
      config: {run: 'echo ok'},
      evaluation_trace: null,
      error: null,
      position: 1,
      current_attempt: 2,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    stubFetch(() =>
      jsonResponse({kind: 'step', step, attempt: 2, lease_token: 'lease-step-scoped'}),
    );
    const leaseClient = createLeaseClient('lease-abc');

    const next = await requestNextStep(leaseClient);

    expect(next).toEqual({kind: 'step', step, attempt: 2, lease_token: 'lease-step-scoped'});
  });

  it('lease clients read rotated lease tokens before each request', async () => {
    stubFetch(() => jsonResponse({kind: 'done', status: 'succeeded'}));
    let leaseToken = 'lease-initial';
    const leaseClient = createLeaseClient(() => leaseToken);

    await requestNextStep(leaseClient);
    leaseToken = 'lease-next';
    await requestNextStep(leaseClient);

    expect(calls.map((call) => call.authorization)).toEqual([
      'Bearer lease-initial',
      'Bearer lease-next',
    ]);
  });

  it('requestCheckoutToken sends the lease token and parses the checkout response', async () => {
    stubFetch(() =>
      jsonResponse({
        repository_url: 'https://github.com/acme/repo.git',
        ref: 'main',
        fetch_depth: 1,
        auth: {
          kind: 'bearer',
          token: 'tok-123',
          expires_at: '2026-01-01T00:00:00.000Z',
          carry: 'header',
          host: 'github.com',
          persist: true,
        },
      }),
    );
    const leaseClient = createLeaseClient('lease-ghi');

    const checkout = await requestCheckoutToken(leaseClient, {stepId: STEP_ID, attempt: 2});

    expect(checkout.repository_url).toBe('https://github.com/acme/repo.git');
    expect(checkout.ref).toBe('main');
    expect(checkout.fetch_depth).toBe(1);
    expect(calls[0]?.url).toContain(`runs/jobs/current/steps/${STEP_ID}/checkout-token?attempt=2`);
    expect(calls[0]?.authorization).toBe('Bearer lease-ghi');
  });

  it('requestAgentRuntimeConfig sends the lease token and parses credentials', async () => {
    stubFetch(() =>
      jsonResponse({
        harness: 'pi',
        provider_id: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {api_key: 'sk-runtime'},
      }),
    );
    const leaseClient = createLeaseClient('lease-runtime');

    const runtimeConfig = await requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    expect(runtimeConfig.credentials.api_key).toBe('sk-runtime');
    expect(runtimeConfig.harness).toBe('pi');
    expect(calls[0]?.url).toContain('runs/jobs/current/agent-runtime-config');
    expect(calls[0]?.url).toContain(`step_id=${STEP_ID}`);
    expect(calls[0]?.url).toContain('attempt=2');
    expect(calls[0]?.authorization).toBe('Bearer lease-runtime');
  });

  it('requestStepSecrets sends the lease token and parses returned secret values', async () => {
    stubFetch(() =>
      jsonResponse({
        secrets: [{store: 'local', key: 'API_TOKEN', value: 'runtime-secret'}],
      }),
    );
    const leaseClient = createLeaseClient('lease-secrets');

    const response = await requestStepSecrets(leaseClient, {stepId: STEP_ID, attempt: 2});

    expect(response.secrets).toEqual([{store: 'local', key: 'API_TOKEN', value: 'runtime-secret'}]);
    expect(calls[0]?.url).toContain(`runs/jobs/current/steps/${STEP_ID}/secrets`);
    expect(calls[0]?.url).toContain('attempt=2');
    expect(calls[0]?.authorization).toBe('Bearer lease-secrets');
  });

  it('requestStepSecrets surfaces HTTP errors as typed request errors', async () => {
    stubFetch(() => jsonResponse({code: 'secret-not-found'}, 422));
    const leaseClient = createLeaseClient('lease-secrets');

    const request = requestStepSecrets(leaseClient, {stepId: STEP_ID, attempt: 2});

    await expect(request).rejects.toMatchObject(
      new StepSecretsRequestError(422, 'secret-not-found'),
    );
  });

  it('requestStepSecrets classifies malformed success bodies without leaking plaintext', async () => {
    const secret = 'super-secret-response-body';
    stubFetch(() => jsonResponse({secrets: [{store: 'local', value: secret}]}));
    const leaseClient = createLeaseClient('lease-secrets');

    const request = requestStepSecrets(leaseClient, {stepId: STEP_ID, attempt: 2});

    await expect(request).rejects.toMatchObject(
      new StepSecretsRequestError(200, 'step-secrets-invalid'),
    );
    await expect(request).rejects.not.toThrow(secret);
    await expect(request).rejects.not.toThrow(ZOD_ERROR_TEXT_REGEX);
  });

  it('requestAgentRuntimeConfig maps server config errors to agent config issues', async () => {
    stubFetch(() => jsonResponse({code: 'model-provider-not-configured'}, 409));
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(
        409,
        'model-provider-not-configured',
        'provider_not_configured',
      ),
    );
  });

  it('requestAgentRuntimeConfig retries transient 429 and 5xx responses', async () => {
    const responses = [
      new Response(null, {status: 429}),
      new Response(null, {status: 500}),
      jsonResponse({
        harness: 'pi',
        provider_id: 'openai',
        model: 'gpt-5.1',
        thinking: 'medium',
        credentials: {api_key: 'sk-runtime'},
      }),
    ];
    stubFetch(() => responses.shift() ?? new Response(null, {status: 500}));
    const leaseClient = createLeaseClient('lease-runtime');

    const runtimeConfig = await requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    expect(runtimeConfig.provider_id).toBe('openai');
    expect(calls).toHaveLength(3);
  });

  it('requestAgentRuntimeConfig surfaces transient retry exhaustion as a typed request error', async () => {
    stubFetch(() => jsonResponse({code: 'temporarily-unavailable'}, 503));
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(503, 'temporarily-unavailable'),
    );
    expect(calls).toHaveLength(3);
  });

  it('requestAgentRuntimeConfig classifies malformed success bodies without leaking Zod text', async () => {
    stubFetch(() => jsonResponse({provider_id: 'openai', credentials: {api_key: 'sk-runtime'}}));
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid'),
    );
    await expect(request).rejects.not.toThrow(ZOD_ERROR_TEXT_REGEX);
  });

  it.each([
    ['empty', ''],
    ['invalid JSON', 'not json'],
  ])('requestAgentRuntimeConfig classifies %s success bodies as invalid runtime config', async (_caseName, body) => {
    stubFetch(() => new Response(body, {status: 200}));
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid'),
    );
    await expect(request).rejects.not.toThrow(SyntaxError);
  });

  it('reportStep sends the lease token to the per-step report endpoint', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-def');

    const result = await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      logOutcome: 'drained',
    });

    expect(result).toEqual({ok: true, cancel: false});
    expect(calls[0]?.url).toContain(`runs/jobs/current/steps/${STEP_ID}/report`);
    expect(calls[0]?.authorization).toBe('Bearer lease-def');
  });

  it('reportStep includes output when present', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-output');

    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      outputs: {sha: 'abc123'},
      logOutcome: 'drained',
    });

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      output: {sha: 'abc123'},
      log_outcome: 'drained',
    });
  });
  it('reportStep includes checkout details as a dedicated field', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-checkout');
    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      checkout: {
        repository: 'acme/api',
        ref: 'refs/pull/412/head',
        commit: '9f2c000000000000000000000000000000000000',
        path: '/runner/workspace/job-1',
      },
      logOutcome: 'drained',
    });

    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      checkout: {
        repository: 'acme/api',
        ref: 'refs/pull/412/head',
        commit: '9f2c000000000000000000000000000000000000',
        path: '/runner/workspace/job-1',
      },
    });
  });
  it('keeps user output separate from checkout details', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-checkout-collision');
    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      outputs: {checkout: 'user-value'},
      checkout: {
        repository: 'acme/api',
        ref: 'main',
        commit: '9f2c000000000000000000000000000000000000',
        path: '/runner/workspace/job-1',
      },
      logOutcome: 'drained',
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      output: {checkout: 'user-value'},
      checkout: {
        repository: 'acme/api',
        ref: 'main',
        commit: '9f2c000000000000000000000000000000000000',
        path: '/runner/workspace/job-1',
      },
      log_outcome: 'drained',
    });
  });

  it('reportStep omits output when it is undefined', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-output');

    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      logOutcome: 'drained',
    });

    expect(JSON.parse(calls[0]?.body ?? '{}')).not.toHaveProperty('output');
  });

  it('reportStep omits output when outputs is explicitly null', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-output-null');

    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      outputs: null,
      logOutcome: 'drained',
    });

    expect(JSON.parse(calls[0]?.body ?? '{}')).not.toHaveProperty('output');
  });

  it('reportStep includes capped response when present', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-response');

    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      response: 'x'.repeat(STEP_RESPONSE_MAX_LENGTH + 1),
      logOutcome: 'drained',
    });

    const body = JSON.parse(calls[0]?.body ?? '{}') as {response?: string};
    expect(body.response).toBe('x'.repeat(STEP_RESPONSE_MAX_LENGTH));
  });

  it('reportStep truncates long error messages before validation and send', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-error');
    const message = 'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH + 1);

    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'failed',
      error: {message},
      exitCode: null,
      logOutcome: 'drained',
    });

    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.error.message).toHaveLength(STEP_ERROR_MESSAGE_MAX_LENGTH);
  });

  it('retries a 400 report without error classification fields', async () => {
    const responses = [
      jsonResponse({code: 'invalid-step-error'}, 400),
      jsonResponse({ok: true, cancel: false}),
    ];
    stubFetch(() => responses.shift() ?? new Response(null, {status: 500}));
    const leaseClient = createLeaseClient('lease-error');

    await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'failed',
      error: {
        message: 'The runner could not start the agent',
        exit_code: null,
        signal: 'SIGTERM',
        reason: 'agent_config_invalid',
        agent_config_issue: 'provider_not_configured',
        field: 'agent_config',
        source: 'runner',
      },
      exitCode: 1,
      logOutcome: 'drained',
    });

    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      status: 'failed',
      attempt: 1,
      exit_code: 1,
      error: {
        message: 'The runner could not start the agent',
        exit_code: null,
        signal: 'SIGTERM',
      },
      log_outcome: 'drained',
    });
  });
});

describe('appendStepLogs', () => {
  it('posts NDJSON to the lease-authed logs endpoint and parses committed', async () => {
    stubFetch(() => jsonResponse({committed_length: 42, capped: false}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
      offset: 10,
      body: new Uint8Array([1, 2, 3]),
    });

    expect(outcome).toEqual({status: 'committed', committedLength: 42, capped: false});
    expect(calls[0]?.url).toContain(`runs/jobs/current/steps/${STEP_ID}/logs`);
    expect(calls[0]?.url).toContain('attempt=2');
    expect(calls[0]?.url).toContain('offset=10');
    expect(calls[0]?.authorization).toBe('Bearer lease-log');
  });

  it('surfaces the capped flag from the server', async () => {
    stubFetch(() => jsonResponse({committed_length: 100, capped: true}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'committed', committedLength: 100, capped: true});
  });

  it('returns conflict with the committed offset on 409', async () => {
    stubFetch(() => jsonResponse({code: 'offset-gap', details: {committed_length: 7}}, 409));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 99,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'conflict', committedLength: 7});
  });

  it('returns stopped when the endpoint is absent (404)', async () => {
    stubFetch(() => new Response(null, {status: 404}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped when the lease is rejected (401)', async () => {
    stubFetch(() => new Response(null, {status: 401}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped when the lease is forbidden (403)', async () => {
    stubFetch(() => new Response(null, {status: 403}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped on a permanently rejected body (400) so it is not retried forever', async () => {
    stubFetch(() => jsonResponse({code: 'malformed-log-chunk'}, 400));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped on an over-large body (413)', async () => {
    stubFetch(() => new Response(null, {status: 413}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('throws on 429 so a transient rate-limit is retried, not abandoned', async () => {
    stubFetch(() => new Response(null, {status: 429}));
    const leaseClient = createLeaseClient('lease-log');

    const append = appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    await expect(append).rejects.toThrow('Log append failed with status 429');
  });

  it('throws on an unexpected status so the uploader retries on its next tick', async () => {
    stubFetch(() => new Response(null, {status: 500}));
    const leaseClient = createLeaseClient('lease-log');

    const append = appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    await expect(append).rejects.toThrow('Log append failed with status 500');
  });

  it('rejects a non-UUID step id before making any request', async () => {
    const leaseClient = createLeaseClient('lease-log');

    const append = appendStepLogs(leaseClient, {
      stepId: '../escape',
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    await expect(append).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('writeStepAnnotations', () => {
  it('posts annotations to the lease-authed endpoint and parses accounting', async () => {
    stubFetch(() =>
      jsonResponse({
        annotations: [{context: 'default', id: crypto.randomUUID()}],
        accounting: {annotation_count: 1, total_body_bytes: 7},
      }),
    );
    const leaseClient = createLeaseClient('lease-annotations');

    const outcome = await writeStepAnnotations(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
    });

    expect(outcome).toEqual({status: 'written', annotationCount: 1, totalBodyBytes: 7});
    expect(calls[0]?.url).toContain('runs/jobs/current/annotations');
    expect(calls[0]?.authorization).toBe('Bearer lease-annotations');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      step_id: STEP_ID,
      attempt: 2,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
    });
  });

  it.each([
    'annotation-body-too-large',
    'annotation-count-limit-exceeded',
    'annotation-total-bytes-limit-exceeded',
  ])('maps capped 413 code %s', async (code) => {
    stubFetch(() => jsonResponse({code}, 413));
    const leaseClient = createLeaseClient('lease-annotations');

    const outcome = await writeStepAnnotations(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
    });

    expect(outcome).toEqual({status: 'capped', code});
  });

  it('maps non-cap errors to rejected and does not retry the POST', async () => {
    stubFetch(() => jsonResponse({code: 'server-error'}, 500));
    const leaseClient = createLeaseClient('lease-annotations');

    const outcome = await writeStepAnnotations(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
    });

    expect(outcome).toEqual({status: 'rejected', statusCode: 500, code: 'server-error'});
    expect(calls).toHaveLength(1);
  });

  it('maps unknown 413 codes to rejected', async () => {
    stubFetch(() => jsonResponse({code: 'other-limit'}, 413));
    const leaseClient = createLeaseClient('lease-annotations');

    const outcome = await writeStepAnnotations(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
    });

    expect(outcome).toEqual({status: 'rejected', statusCode: 413, code: 'other-limit'});
  });
});

function claimResponse() {
  return {
    job_id: JOB_ID,
    job_execution_id: JOB_EXECUTION_ID,
    workflow_run_id: WORKFLOW_RUN_ID,
    workflow_run_attempt_id: WORKFLOW_RUN_ATTEMPT_ID,
    lease_token: 'lease-xyz',
  };
}

function registerResponse() {
  return {
    session_token: 'session-abc',
    session_id: SESSION_ID,
    mode: 'manual',
    max_claims: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
      body: await request.clone().text(),
      signal: request.signal,
    });
    return handler(request.url);
  }) as unknown as typeof globalThis.fetch;
}
