import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {HTTPError} from 'ky';

const requestCheckoutTokenMock = vi.fn();
const checkoutRepositoryMock = vi.fn();
const writeAmbientGitCredentialMock = vi.fn();

vi.mock('@shipfox/runner-protocol', () => ({
  requestCheckoutToken: (...args: unknown[]) => requestCheckoutTokenMock(...args),
  HTTPError,
}));

vi.mock('@shipfox/runner-workspace', async () => {
  const actual = await vi.importActual<typeof import('@shipfox/runner-workspace')>(
    '@shipfox/runner-workspace',
  );
  return {
    ...actual,
    checkoutRepository: (...args: unknown[]) => checkoutRepositoryMock(...args),
    writeAmbientGitCredential: (...args: unknown[]) => writeAmbientGitCredentialMock(...args),
  };
});

const {executeCheckoutStep} = await import('#core/checkout-step.js');

const JOB_EXECUTION_ID = '00000000-0000-0000-0000-0000000000a1';
const GIT_CONFIG_PATH = '/tmp/shipfox-checkout-test/git-cred.config';
const signal = new AbortController().signal;
const leaseClient = {} as never;

function checkoutResponse(repository = 'repo-a', ref = 'main') {
  return {
    repository_url: `https://github.com/acme/${repository}.git`,
    ref,
    fetch_depth: 1,
  };
}

function checkoutStep(config: Record<string, unknown> = {}): StepDto {
  return {
    id: crypto.randomUUID(),
    job_execution_id: JOB_EXECUTION_ID,
    key: null,
    name: 'Checkout',
    source_location: null,
    status: 'running',
    type: 'checkout',
    config: {checkout: config},
    error: null,
    position: 1,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
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

describe('executeCheckoutStep', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-checkout-executor-')));
    vi.clearAllMocks();
    requestCheckoutTokenMock.mockResolvedValue(checkoutResponse());
    checkoutRepositoryMock.mockResolvedValue('abc123');
    writeAmbientGitCredentialMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await rm(workspace, {recursive: true, force: true});
  });

  function run(config: Record<string, unknown> = {}, destinations = new Map(), log = fakeLog()) {
    return executeCheckoutStep({
      cwd: workspace,
      gitConfigPath: GIT_CONFIG_PATH,
      leaseClient,
      signal,
      step: checkoutStep(config),
      attempt: 1,
      destinations,
      log,
    });
  }

  it('checks out into a missing explicit path and reports the resolved destination', async () => {
    const destinations = new Map();

    const result = await run({path: 'services/api'}, destinations);

    const destination = resolve(workspace, 'services/api');
    expect(checkoutRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({cwd: destination, fetchDepth: 1}),
    );
    expect(result).toEqual({
      result: {
        success: true,
        error: null,
        exit_code: 0,
        checkout: {
          repository: 'https://github.com/acme/repo-a.git',
          ref: 'main',
          commit: 'abc123',
          path: destination,
        },
      },
    });
    expect(destinations.get(destination)?.repository).toBe('https://github.com/acme/repo-a.git');
  });

  it.each(['missing', 'empty'])('checks out into a %s destination', async (state) => {
    const destination = join(workspace, 'repo');
    if (state === 'empty') await mkdir(destination);

    const result = await run({path: 'repo'});

    expect(result.result.success).toBe(true);
    expect(checkoutRepositoryMock).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'empty'])('checks out into a %s destination with force', async (state) => {
    const destination = join(workspace, 'repo');
    if (state === 'empty') await mkdir(destination);

    const result = await run({path: 'repo', force: true});

    expect(result.result.success).toBe(true);
    expect(checkoutRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({cwd: destination}),
    );
  });

  it('re-checks out the same target at an owned path with force, discarding changes', async () => {
    const destinations = new Map();
    await run({path: 'repo'}, destinations);
    const destination = resolve(workspace, 'repo');
    await writeFile(join(destination, 'agent-change.txt'), 'discard me');
    checkoutRepositoryMock.mockClear();

    const result = await run({path: 'repo', force: true}, destinations);

    expect(result.result.success).toBe(true);
    expect(checkoutRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({cwd: destination}),
    );
    await expect(readFile(join(destination, 'agent-change.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(destinations.get(destination)?.repository).toBe('https://github.com/acme/repo-a.git');
  });

  it('refuses to overwrite an occupied destination by default', async () => {
    const destination = join(workspace, 'repo');
    await mkdir(destination);
    await writeFile(join(destination, 'agent-change.txt'), 'keep me');

    const result = await run({path: 'repo'});

    expect(result.result).toEqual({
      success: false,
      error: {
        message: expect.stringContaining('Checkout destination is occupied'),
        reason: 'checkout_destination_occupied',
      },
      exit_code: null,
    });
    expect(checkoutRepositoryMock).not.toHaveBeenCalled();
    await expect(readFile(join(destination, 'agent-change.txt'), 'utf8')).resolves.toBe('keep me');
  });

  it('replaces an occupied destination only when force is set', async () => {
    const destination = join(workspace, 'repo');
    await mkdir(destination);
    await writeFile(join(destination, 'agent-change.txt'), 'discard me');

    const result = await run({path: 'repo', force: true});

    expect(result.result.success).toBe(true);
    expect(checkoutRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({cwd: destination}),
    );
    await expect(readFile(join(destination, 'agent-change.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not invoke Git when a gate restart repeats the same target at the same path', async () => {
    const destinations = new Map();
    const first = await run({path: 'repo'}, destinations);
    const destination = resolve(workspace, 'repo');
    await writeFile(join(destination, 'agent-change.txt'), 'preserve me');
    checkoutRepositoryMock.mockClear();

    const second = await run({path: 'repo'}, destinations);

    expect(first.result.success).toBe(true);
    expect(second).toEqual(first);
    expect(checkoutRepositoryMock).not.toHaveBeenCalled();
    await expect(readFile(join(destination, 'agent-change.txt'), 'utf8')).resolves.toBe(
      'preserve me',
    );
  });

  it('refuses a different target at an owned path without force', async () => {
    const destinations = new Map();
    await run({path: 'shared'}, destinations);
    requestCheckoutTokenMock.mockResolvedValue(checkoutResponse('repo-b'));
    checkoutRepositoryMock.mockClear();

    const result = await run({path: 'shared'}, destinations);

    expect(result.result.error?.reason).toBe('checkout_destination_occupied');
    expect(checkoutRepositoryMock).not.toHaveBeenCalled();
  });

  it('replaces a different target at an owned path with force', async () => {
    const destinations = new Map();
    await run({path: 'shared'}, destinations);
    requestCheckoutTokenMock.mockResolvedValue(checkoutResponse('repo-b'));

    const result = await run({path: 'shared', force: true}, destinations);

    expect(result.result.success).toBe(true);
    expect(checkoutRepositoryMock).toHaveBeenCalledTimes(2);
    expect(destinations.get(resolve(workspace, 'shared'))?.repository).toContain('repo-b');
  });

  it('releases nested ownership when force replaces an ancestor', async () => {
    const destinations = new Map();
    await run({path: 'lib-a'}, destinations);
    requestCheckoutTokenMock.mockResolvedValue(checkoutResponse('repo-b'));
    await run({path: '.', force: true}, destinations);
    requestCheckoutTokenMock.mockResolvedValue(checkoutResponse('repo-a'));
    checkoutRepositoryMock.mockClear();

    const result = await run({path: 'lib-a'}, destinations);

    expect(result.result.success).toBe(true);
    expect(checkoutRepositoryMock).toHaveBeenCalledOnce();
    expect(destinations.get(resolve(workspace, 'lib-a'))?.repository).toContain('repo-a');
  });

  it('uses the job root for the first default checkout and the repository name thereafter', async () => {
    const destinations = new Map();
    const first = await run({}, destinations);
    requestCheckoutTokenMock.mockResolvedValue(checkoutResponse('repo-b'));
    const second = await run({}, destinations);

    expect(first.result.checkout?.path).toBe(workspace);
    expect(second.result.checkout?.path).toBe(join(workspace, 'repo-b'));
  });

  it.each([
    '../outside',
    '/tmp/outside',
    'C:outside',
    'C:\\outside',
    '.git',
    'src/.git',
  ])('rejects an unsafe path before requesting repository access: %s', async (path) => {
    const result = await run({path});

    expect(result.result.error?.reason).toBe('checkout_path_invalid');
    expect(requestCheckoutTokenMock).not.toHaveBeenCalled();
    expect(checkoutRepositoryMock).not.toHaveBeenCalled();
  });
});
