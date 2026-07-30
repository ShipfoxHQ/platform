import {logger} from '@shipfox/node-opentelemetry';
import {HTTPError} from 'ky';

const requestCheckoutTokenMock = vi.fn();
const assertGitAvailableMock = vi.fn();
const createJobDirMock = vi.fn();
const checkoutRepositoryMock = vi.fn();
const writeAmbientGitCredentialMock = vi.fn();

vi.mock('@shipfox/runner-protocol', () => ({
  requestCheckoutToken: (...args: unknown[]) => requestCheckoutTokenMock(...args),
  HTTPError,
}));

// CheckoutError is a real class (setup-step branches on instanceof), so keep the actual
// implementation and only stub the side-effecting functions.
vi.mock('@shipfox/runner-workspace', async () => {
  const actual = await vi.importActual<typeof import('@shipfox/runner-workspace')>(
    '@shipfox/runner-workspace',
  );
  return {
    ...actual,
    assertGitAvailable: (...args: unknown[]) => assertGitAvailableMock(...args),
    createJobDir: (...args: unknown[]) => createJobDirMock(...args),
    checkoutRepository: (...args: unknown[]) => checkoutRepositoryMock(...args),
    writeAmbientGitCredential: (...args: unknown[]) => writeAmbientGitCredentialMock(...args),
  };
});

const {executeSetupStep} = await import('#core/setup-step.js');
const {CheckoutError} = await import('@shipfox/runner-workspace');

const CWD = '/tmp/shipfox-test-root/job-1';
const GIT_CONFIG_PATH = '/tmp/shipfox-test-root/.shipfox-runner-cred/job-1/git-cred.config';
const leaseClient = {} as never;
const signal = new AbortController().signal;
const jobContext = {
  workflowRunId: '00000000-0000-0000-0000-0000000000ac',
  workflowRunAttemptId: '00000000-0000-0000-0000-0000000000ab',
  jobId: '00000000-0000-0000-0000-0000000000aa',
  jobExecutionId: '00000000-0000-0000-0000-0000000000ad',
};

function checkoutResponse(auth?: unknown, gitAuthor?: unknown) {
  return {
    repository_url: 'https://github.com/acme/repo.git',
    ref: 'main',
    auth,
    ...(gitAuthor ? {git_author: gitAuthor} : {}),
  };
}

function run(log?: ReturnType<typeof fakeLog>) {
  return executeSetupStep({
    cwd: CWD,
    gitConfigPath: GIT_CONFIG_PATH,
    leaseClient,
    signal,
    ...(log ? {log} : {}),
    jobContext,
  });
}

function fakeLog() {
  return {
    writeGroupStart: vi.fn(),
    writeGroupEnd: vi.fn(),
    writeGroup: vi.fn(),
    writeOutputLine: vi.fn(),
    write: vi.fn(),
    addSecrets: vi.fn(),
  };
}

function spySetupWarnings() {
  return vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
}

function expectSetupFailureWarning(
  warn: ReturnType<typeof spySetupWarnings>,
  reason: string,
): void {
  expect(warn).toHaveBeenCalledWith({...jobContext, reason}, 'Setup step failed');
}

// ky populates `error.data` with the pre-parsed body and consumes `error.response`, so
// the production classifier reads `error.data` — mirror that here rather than faking a
// re-readable `response.clone().json()`, which production can never do.
function httpError(status: number, body?: unknown): HTTPError {
  const response = {status} as unknown as Response;
  const error = new HTTPError(
    response,
    {} as Request,
    {} as ConstructorParameters<typeof HTTPError>[2],
  );
  error.data = body;
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
  assertGitAvailableMock.mockResolvedValue('git version 2.51.0');
  createJobDirMock.mockResolvedValue(undefined);
  requestCheckoutTokenMock.mockResolvedValue(checkoutResponse());
  checkoutRepositoryMock.mockResolvedValue('abc123');
  writeAmbientGitCredentialMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('executeSetupStep', () => {
  it('prepares the workspace, checks out the repo, and succeeds', async () => {
    requestCheckoutTokenMock.mockResolvedValue(
      checkoutResponse(
        {
          kind: 'bearer',
          token: 't',
          expires_at: '2026-01-01T00:00:00Z',
          carry: 'header',
          host: 'github.com',
          persist: true,
        },
        {
          name: 'shipfox-test[bot]',
          email: '1+shipfox-test[bot]@users.noreply.github.com',
        },
      ),
    );

    const result = await run();

    expect(assertGitAvailableMock).toHaveBeenCalledOnce();
    expect(createJobDirMock).toHaveBeenCalledWith(CWD);
    expect(requestCheckoutTokenMock).toHaveBeenCalledWith(leaseClient, {signal});
    expect(checkoutRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: 'https://github.com/acme/repo.git',
        ref: 'main',
        auth: {
          kind: 'bearer',
          token: 't',
          expires_at: '2026-01-01T00:00:00Z',
          carry: 'header',
          host: 'github.com',
          persist: true,
        },
        cwd: CWD,
        signal,
        onSecrets: expect.any(Function),
        onCommandStart: expect.any(Function),
      }),
    );
    expect(writeAmbientGitCredentialMock).toHaveBeenCalledWith({
      configPath: GIT_CONFIG_PATH,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'bearer',
        token: 't',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
      gitAuthor: {
        name: 'shipfox-test[bot]',
        email: '1+shipfox-test[bot]@users.noreply.github.com',
      },
    });
    expect(result).toEqual({
      result: {
        success: true,
        error: null,
        exit_code: 0,
        checkout: {
          repository: 'https://github.com/acme/repo.git',
          ref: 'main',
          commit: 'abc123',
          path: CWD,
        },
      },
      ambientGitConfigPath: GIT_CONFIG_PATH,
    });
  });

  it('does not persist ambient credentials when persist is false', async () => {
    requestCheckoutTokenMock.mockResolvedValue(
      checkoutResponse({
        kind: 'bearer',
        token: 't',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: false,
      }),
    );

    const result = await run();

    expect(writeAmbientGitCredentialMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      result: {
        success: true,
        error: null,
        exit_code: 0,
        checkout: {
          repository: 'https://github.com/acme/repo.git',
          ref: 'main',
          commit: 'abc123',
          path: CWD,
        },
      },
    });
  });

  it('warns and succeeds when ambient credential writing fails', async () => {
    const log = fakeLog();
    requestCheckoutTokenMock.mockResolvedValue(
      checkoutResponse({
        kind: 'bearer',
        token: 't',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      }),
    );
    writeAmbientGitCredentialMock.mockRejectedValue(new Error('disk denied'));

    const result = await run(log);

    expect(result).toEqual({
      result: {
        success: true,
        error: null,
        exit_code: 0,
        checkout: {
          repository: 'https://github.com/acme/repo.git',
          ref: 'main',
          commit: 'abc123',
          path: CWD,
        },
      },
    });
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Repository access was not persisted',
      lines: [
        'The checkout succeeded, but agent steps will run without ambient git authentication. Details: disk denied',
        'Git commands in later steps may need their own credentials.',
      ],
      source: 'stderr',
    });
  });

  it('logs ambient credential persistence warnings when setup log capture is unavailable', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    requestCheckoutTokenMock.mockResolvedValue(
      checkoutResponse({
        kind: 'bearer',
        token: 't',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      }),
    );
    writeAmbientGitCredentialMock.mockRejectedValue(new Error('disk denied'));

    const result = await run();

    expect(result).toEqual({
      result: {
        success: true,
        error: null,
        exit_code: 0,
        checkout: {
          repository: 'https://github.com/acme/repo.git',
          ref: 'main',
          commit: 'abc123',
          path: CWD,
        },
      },
    });
    expect(warn).toHaveBeenCalledWith(
      {
        name: 'Repository access was not persisted',
        lines: [
          'The checkout succeeded, but agent steps will run without ambient git authentication. Details: disk denied',
          'Git commands in later steps may need their own credentials.',
        ],
      },
      'Setup warning',
    );
  });

  it('writes setup groups and the final checked-out commit', async () => {
    const log = fakeLog();

    const result = await run(log);

    expect(result.result.success).toBe(true);
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Job details',
      lines: [
        `Workflow run: ${jobContext.workflowRunId}`,
        `Workflow run attempt: ${jobContext.workflowRunAttemptId}`,
        `Job: ${jobContext.jobId}`,
        `Job execution: ${jobContext.jobExecutionId}`,
      ],
    });
    expect(log.writeGroupStart).toHaveBeenCalledWith('Checkout');
    expect(log.writeGroupEnd).toHaveBeenCalledTimes(1);
    expect(log.writeGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Runner environment',
        lines: expect.arrayContaining(['Git: git version 2.51.0']),
      }),
    );
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Request repository access',
      lines: ['Requesting short-lived repository access from Shipfox.'],
    });
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Repository access granted',
      lines: ['No repository credential was required.'],
    });
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Checkout complete',
      lines: ['Checked out commit: abc123'],
    });
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Setup completed successfully. The job is ready to run.',
    );
  });

  it('writes the image and runner build identity', async () => {
    vi.stubEnv('RUNNER_VERSION', '0.1.13');
    vi.stubEnv('IMAGE_REVISION', '0123456789abcdef');
    vi.stubEnv('IMAGE_CREATED', '2026-07-27T10:00:00.000Z');
    vi.stubEnv('BUILD_NUMBER', '42');
    const log = fakeLog();

    await run(log);

    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Runner environment',
      lines: expect.arrayContaining([
        'Runner version: 0.1.13',
        'Runner image revision: 0123456789abcdef',
        'Runner image created: 2026-07-27T10:00:00.000Z',
        'Runner build number: 42',
      ]),
    });
  });

  it('writes structured setup lifecycle logs', async () => {
    const info = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);

    const result = await run();

    expect(result.result.success).toBe(true);
    expect(info).toHaveBeenCalledWith(jobContext, 'Setup step started');
    expect(info).toHaveBeenCalledWith(jobContext, 'Setup step completed');
  });

  it('routes checkout callbacks to the setup log sink', async () => {
    const log = fakeLog();

    await run(log);
    const [{onSecrets, onCommandStart, onOutput}] = checkoutRepositoryMock.mock.calls[0] as [
      {
        onSecrets: (secrets: string[]) => void;
        onCommandStart: (metadata: {phase: 'fetch'; command: string; cwd: string}) => void;
        onOutput: (chunk: Buffer, source: 'stdout') => void;
      },
    ];
    onSecrets(['tok-123']);
    onCommandStart({phase: 'fetch', command: 'git fetch origin main', cwd: CWD});
    onOutput(Buffer.from('remote output'), 'stdout');

    expect(log.addSecrets).toHaveBeenCalledWith(['tok-123']);
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Fetch requested ref',
      lines: ['Command: git fetch origin main', `Working directory: ${CWD}`],
    });
    expect(log.write).toHaveBeenCalledWith(Buffer.from('remote output'), 'stdout');
  });

  it('checks git before minting a credential', async () => {
    const log = fakeLog();
    const warn = spySetupWarnings();
    assertGitAvailableMock.mockRejectedValue(new Error('git is not available on the runner host'));

    const result = await run(log);

    expect(requestCheckoutTokenMock).not.toHaveBeenCalled();
    expect(createJobDirMock).not.toHaveBeenCalled();
    expect(result.result.success).toBe(false);
    expect(result.result.error?.reason).toBe('git_unavailable');
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Setup failed because Git is not available on the runner. Details: git is not available on the runner host',
      'stderr',
    );
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Next step: Install Git in the runner image or use a runner image that includes Git.',
      'stderr',
    );
    expectSetupFailureWarning(warn, 'git_unavailable');
  });

  it('reports workspace_prep_failed when creating the directory fails', async () => {
    const log = fakeLog();
    const warn = spySetupWarnings();
    createJobDirMock.mockRejectedValue(new Error('mkdir denied'));

    const result = await run(log);

    expect(requestCheckoutTokenMock).not.toHaveBeenCalled();
    expect(result.result.error).toEqual({message: 'mkdir denied', reason: 'workspace_prep_failed'});
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Setup failed because the runner could not prepare the workspace. Details: mkdir denied',
      'stderr',
    );
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Next step: Check the runner workspace permissions and available disk space.',
      'stderr',
    );
    expectSetupFailureWarning(warn, 'workspace_prep_failed');
  });

  it.each([
    {status: 401, reason: 'checkout_auth_failed'},
    {status: 403, reason: 'checkout_auth_failed'},
    {status: 429, reason: 'checkout_unavailable'},
    {status: 503, reason: 'checkout_unavailable'},
    {status: 404, reason: 'checkout_failed'},
    {status: 409, reason: 'checkout_failed'},
    {status: 422, reason: 'checkout_failed'},
  ])('maps a $status checkout-token error to $reason', async ({status, reason}) => {
    const warn = spySetupWarnings();
    requestCheckoutTokenMock.mockRejectedValue(httpError(status));

    const result = await run();

    expect(checkoutRepositoryMock).not.toHaveBeenCalled();
    expect(result.result.success).toBe(false);
    expect(result.result.error?.reason).toBe(reason);
    expectSetupFailureWarning(warn, reason);
  });

  it.each([
    {code: 'access-denied', reason: 'checkout_auth_failed'},
    {code: 'rate-limited', reason: 'checkout_unavailable'},
    {code: 'provider-unavailable', reason: 'checkout_unavailable'},
  ])('maps a 422 with code $code to $reason', async ({code, reason}) => {
    const warn = spySetupWarnings();
    requestCheckoutTokenMock.mockRejectedValue(httpError(422, {code}));

    const result = await run();

    expect(result.result.error?.reason).toBe(reason);
    expectSetupFailureWarning(warn, reason);
  });

  it('maps a non-HTTP checkout-token error to checkout_failed', async () => {
    const warn = spySetupWarnings();
    requestCheckoutTokenMock.mockRejectedValue(new Error('socket hang up'));

    const result = await run();

    expect(result.result.error).toEqual({message: 'socket hang up', reason: 'checkout_failed'});
    expectSetupFailureWarning(warn, 'checkout_failed');
  });

  it.each([
    {kind: 'auth' as const, reason: 'checkout_auth_failed'},
    {kind: 'unavailable' as const, reason: 'checkout_unavailable'},
    {kind: 'failed' as const, reason: 'checkout_failed'},
    {kind: 'aborted' as const, reason: 'setup_aborted'},
  ])('maps a $kind checkout failure to $reason', async ({kind, reason}) => {
    const warn = spySetupWarnings();
    checkoutRepositoryMock.mockRejectedValue(new CheckoutError(kind, 'boom'));

    const result = await run();

    expect(result.result.success).toBe(false);
    expect(result.result.error?.reason).toBe(reason);
    expectSetupFailureWarning(warn, reason);
  });

  it('logs the checkout phase that failed', async () => {
    const log = fakeLog();
    const warn = spySetupWarnings();
    checkoutRepositoryMock.mockRejectedValue(
      new CheckoutError('failed', 'remote rejected', {phase: 'fetch'}),
    );

    const result = await run(log);

    expect(result.result.error?.reason).toBe('checkout_failed');
    expect(log.writeGroupStart).toHaveBeenCalledWith('Checkout');
    expect(log.writeGroupEnd).toHaveBeenCalledTimes(1);
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Setup failed while fetching the requested ref. Details: remote rejected',
      'stderr',
    );
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Next step: Check that the repository URL and requested ref are valid. The git output above may include provider details.',
      'stderr',
    );
    expectSetupFailureWarning(warn, 'checkout_failed');
  });

  it('maps an unexpected checkout error to checkout_failed', async () => {
    const warn = spySetupWarnings();
    checkoutRepositoryMock.mockRejectedValue(new Error('weird'));

    const result = await run();

    expect(result.result.error).toEqual({message: 'weird', reason: 'checkout_failed'});
    expectSetupFailureWarning(warn, 'checkout_failed');
  });
});
