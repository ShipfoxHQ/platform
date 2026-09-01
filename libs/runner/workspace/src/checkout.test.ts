import {EventEmitter} from 'node:events';
import {readFileSync, writeFileSync} from 'node:fs';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const execFileMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const {
  assertGitAvailable,
  checkoutRepository,
  CheckoutError,
  redactSecrets,
  writeAmbientGitCredential,
  writeGitCredentialHelperConfig,
} = await import('#checkout.js');

type SpawnResult =
  | {kind: 'success'; stdout?: string; stderr?: string}
  | {kind: 'failure'; stderr: string; code?: number; signal?: NodeJS.Signals | null}
  | {kind: 'error'; error: Error};

function queueGitResults(results: SpawnResult[]) {
  const queue = [...results];
  spawnMock.mockImplementation(() => {
    const result = queue.shift();
    if (!result) throw new Error('Unexpected git command');

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    queueMicrotask(() => {
      if (result.kind === 'error') {
        child.emit('error', result.error);
        return;
      }
      if (result.kind === 'success' && result.stdout) {
        child.stdout.emit('data', Buffer.from(result.stdout));
      }
      if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
      if (result.kind === 'success') {
        child.emit('close', 0, null);
        return;
      }
      child.emit('close', result.code ?? 1, result.signal ?? null);
    });

    return child;
  });
}

function queueSuccessfulCheckout(commit = 'abc123') {
  queueGitResults([
    {kind: 'success'},
    {kind: 'success'},
    {kind: 'success', stderr: 'fetch progress\n'},
    {kind: 'success', stderr: 'checkout progress\n'},
    {kind: 'success', stdout: `${commit}\n`},
  ]);
}

function queueFetchFailure(stderr: string) {
  queueGitResults([{kind: 'success'}, {kind: 'success'}, {kind: 'failure', stderr}]);
}

const BASE = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main', cwd: '/work/job-1'};
const GITHUB_INSTALLATION_TOKEN_PATTERN = /^ghs_[A-Za-z0-9._-]{36,}$/u;
const GITHUB_STATEFUL_INSTALLATION_TOKEN = `ghs_${'d'.repeat(36)}`;
const GITHUB_STATELESS_INSTALLATION_TOKEN =
  `ghs_123456_${'a'.repeat(169)}` + `.${'b'.repeat(169)}` + `.${'c'.repeat(169)}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkoutRepository argv', () => {
  it('runs explicit checkout phases without auth when there is no auth', async () => {
    queueSuccessfulCheckout();

    const commit = await checkoutRepository(BASE);

    expect(commit).toBe('abc123');
    expect(spawnMock.mock.calls.map((call) => call[1])).toEqual([
      ['init'],
      ['remote', 'add', 'origin', 'https://github.com/acme/repo.git'],
      ['fetch', '--progress', '--no-tags', '--prune', '--depth=1', 'origin', 'main'],
      ['checkout', '--progress', '--force', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
  });
  it('passes a positive fetch depth to git', async () => {
    queueSuccessfulCheckout();

    await checkoutRepository({...BASE, fetchDepth: 5});

    expect(spawnMock.mock.calls[2]?.[1]).toEqual([
      'fetch',
      '--progress',
      '--no-tags',
      '--prune',
      '--depth=5',
      'origin',
      'main',
    ]);
  });
  it('omits the depth flag when fetching full history', async () => {
    queueSuccessfulCheckout();

    await checkoutRepository({...BASE, fetchDepth: 0});

    expect(spawnMock.mock.calls[2]?.[1]).toEqual([
      'fetch',
      '--progress',
      '--no-tags',
      '--prune',
      'origin',
      'main',
    ]);
  });

  it.each([-1, 1.5, Number.NaN])('rejects invalid fetch depth %s', async (fetchDepth) => {
    await expect(checkoutRepository({...BASE, fetchDepth})).rejects.toThrow(
      'fetchDepth must be a non-negative integer',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it('injects a bearer credential only on fetch and excludes it from displayed commands', async () => {
    queueSuccessfulCheckout();
    const onCommandStart = vi.fn();
    const onSecrets = vi.fn();

    await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'bearer',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
      onCommandStart,
      onSecrets,
    });

    const fetchArgs = spawnMock.mock.calls[2]?.[1] as string[];
    expect(fetchArgs).toEqual([
      'fetch',
      '--progress',
      '--no-tags',
      '--prune',
      '--depth=1',
      'origin',
      'main',
    ]);
    const fetchOptions = spawnMock.mock.calls[2]?.[2] as {env: Record<string, string>};
    expect(fetchOptions.env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'http.https://github.com/acme/repo.git.extraHeader',
      GIT_CONFIG_VALUE_0: 'Authorization: Bearer tok-123',
      GIT_CONFIG_KEY_1: 'http.followRedirects',
      GIT_CONFIG_VALUE_1: 'false',
    });
    expect(onSecrets).toHaveBeenCalledWith(['tok-123']);
    expect(onCommandStart.mock.calls.map((call) => call[0].command).join('\n')).not.toContain(
      'tok-123',
    );
  });

  it('strips inherited GIT_CONFIG_PARAMETERS and indexed config before injecting fetch auth', async () => {
    const prior = {
      GIT_CONFIG_PARAMETERS: process.env.GIT_CONFIG_PARAMETERS,
      GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
      GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
      GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
      GIT_CONFIG_KEY_99: process.env.GIT_CONFIG_KEY_99,
      GIT_CONFIG_VALUE_99: process.env.GIT_CONFIG_VALUE_99,
    };
    process.env.GIT_CONFIG_PARAMETERS = "'credential.helper=store'";
    process.env.GIT_CONFIG_COUNT = '100';
    process.env.GIT_CONFIG_KEY_0 = 'http.https://evil.example.extraHeader';
    process.env.GIT_CONFIG_VALUE_0 = 'Authorization: Bearer stale';
    process.env.GIT_CONFIG_KEY_99 = 'http.followRedirects';
    process.env.GIT_CONFIG_VALUE_99 = 'true';
    queueSuccessfulCheckout();

    try {
      await checkoutRepository({
        ...BASE,
        auth: {
          kind: 'bearer',
          token: 'tok-123',
          expires_at: '2026-01-01T00:00:00Z',
          carry: 'header',
          host: 'github.com',
          persist: true,
        },
      });
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    const initOptions = spawnMock.mock.calls[0]?.[2] as {env: Record<string, string>};
    const fetchOptions = spawnMock.mock.calls[2]?.[2] as {env: Record<string, string>};
    expect(initOptions.env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(initOptions.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(fetchOptions.env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(fetchOptions.env.GIT_CONFIG_COUNT).toBe('2');
    expect(fetchOptions.env.GIT_CONFIG_KEY_0).toBe(
      'http.https://github.com/acme/repo.git.extraHeader',
    );
    expect(fetchOptions.env.GIT_CONFIG_VALUE_0).toBe('Authorization: Bearer tok-123');
    expect(fetchOptions.env.GIT_CONFIG_KEY_99).toBeUndefined();
    expect(fetchOptions.env.GIT_CONFIG_VALUE_99).toBeUndefined();
  });

  it.each([
    {format: 'stateful', token: GITHUB_STATEFUL_INSTALLATION_TOKEN},
    {format: 'stateless', token: GITHUB_STATELESS_INSTALLATION_TOKEN},
  ])('injects a $format GitHub token as a basic header and registers both secrets', async ({
    token,
  }) => {
    queueSuccessfulCheckout();
    const onSecrets = vi.fn();
    const expected = Buffer.from(`x-access-token:${token}`).toString('base64');

    await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token,
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
      onSecrets,
    });

    const fetchArgs = spawnMock.mock.calls[2]?.[1] as string[];
    const fetchOptions = spawnMock.mock.calls[2]?.[2] as {env: Record<string, string>};
    expect(token).toMatch(GITHUB_INSTALLATION_TOKEN_PATTERN);
    expect(fetchArgs[0]).toBe('fetch');
    expect(fetchOptions.env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${expected}`);
    expect(onSecrets).toHaveBeenCalledWith([token, expected]);
  });

  it('disables interactive credential prompts on every git process', async () => {
    queueSuccessfulCheckout();

    await checkoutRepository(BASE);

    for (const call of spawnMock.mock.calls) {
      const options = call[2] as {env: Record<string, string>};
      expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');
    }
  });

  it('streams git output through the provided sink', async () => {
    queueSuccessfulCheckout();
    const onOutput = vi.fn();

    await checkoutRepository({...BASE, onOutput});

    expect(onOutput).toHaveBeenCalledWith(Buffer.from('fetch progress\n'), 'stderr');
    expect(onOutput).toHaveBeenCalledWith(Buffer.from('checkout progress\n'), 'stderr');
    expect(onOutput).toHaveBeenCalledWith(Buffer.from('abc123\n'), 'stdout');
  });
});

describe('checkoutRepository failure classification', () => {
  it('classifies a rejected credential as an auth failure', async () => {
    queueFetchFailure("fatal: Authentication failed for 'https://github.com/acme/repo.git/'");

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({
      name: 'CheckoutError',
      kind: 'auth',
      phase: 'fetch',
    });
  });

  it('classifies an unreachable provider as unavailable', async () => {
    queueFetchFailure('fatal: unable to access: Could not resolve host: github.com');

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies a git-side 403 as an auth failure', async () => {
    queueFetchFailure(
      "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 403",
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'auth'});
  });

  it('classifies a git-side 5xx as unavailable', async () => {
    queueFetchFailure(
      "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 503",
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies a git-side 429 as unavailable', async () => {
    queueFetchFailure(
      "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 429",
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies an unknown checkout failure as a generic failure', async () => {
    queueFetchFailure('fatal: Remote branch main not found in upstream origin');

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'failed'});
  });

  it('classifies an aborted checkout as aborted with its phase', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), {name: 'AbortError'});
    queueGitResults([{kind: 'success'}, {kind: 'success'}, {kind: 'error', error: abortError}]);

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'aborted', phase: 'fetch'});
    expect('phase' in abortError).toBe(false);
  });

  it('redacts the token from a failure message', async () => {
    queueFetchFailure('fatal: bad request sending tok-123 to remote');

    const error = await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'bearer',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CheckoutError);
    expect((error as Error).message).not.toContain('tok-123');
    expect((error as Error).message).toContain('***');
  });

  it('redacts the base64 form of a basic credential from a failure message', async () => {
    const base64 = Buffer.from('x-token:tok-123').toString('base64');
    queueFetchFailure(`fatal: bad request sending ${base64} to remote`);

    const error = await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'basic',
        username: 'x-token',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    }).catch((e: unknown) => e);

    expect((error as Error).message).not.toContain(base64);
    expect((error as Error).message).toContain('***');
  });

  it('scrubs the token from the error cause so it cannot ride the cause chain into a log', async () => {
    queueFetchFailure('fatal: Authentication failed for token tok-123');

    const error = await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'bearer',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    }).catch((e: unknown) => e);

    const cause = (error as Error).cause as Error;
    expect(cause.message).not.toContain('tok-123');
  });
});

function mockExistingGitCredentialConfig(): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: null, result: {stdout: string; stderr: string}) => void;
    const command = args[1] as string[];
    const temporaryPath = command[2];
    if (typeof temporaryPath !== 'string') throw new Error('Unexpected Git config command');
    if (command.includes('--unset-all')) removeGitConfigValue(temporaryPath, command[4]);
    callback(null, {stdout: gitConfigKeysOutput(command), stderr: ''});
  });
}

function removeGitConfigValue(temporaryPath: string, key: string | undefined): void {
  if (typeof key !== 'string') throw new Error('Unexpected Git config key');
  const property = key.split('.').at(-1);
  const section = key.startsWith('http.')
    ? '[http "https://github.com/acme/repo.git"]'
    : '[credential "https://github.com/acme/repo.git"]';
  let inTargetSection = false;
  const current = readFileSync(temporaryPath, 'utf8');
  const withoutValue = current
    .split('\n')
    .filter((line) => {
      if (line.startsWith('[')) inTargetSection = line === section;
      return !(
        inTargetSection && line.trimStart().toLowerCase().startsWith(`${property?.toLowerCase()} =`)
      );
    })
    .join('\n');
  writeFileSync(temporaryPath, withoutValue);
}

function gitConfigKeysOutput(command: string[]): string {
  if (!command.includes('--get-regexp')) return '';
  return [
    'credential.https://github.com/acme/repo.git.helper',
    'credential.https://github.com/acme/repo.git.username',
    'credential.https://github.com/acme/repo.git.password',
    'http.https://github.com/acme/repo.git.extraheader',
  ].join('\n');
}

describe('writeAmbientGitCredential', () => {
  let root: string;
  let priorGitConfigGlobal: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-ambient-git-'));
    priorGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_GLOBAL;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (
        error: null,
        result: {stdout: string; stderr: string},
      ) => void;
      callback(null, {stdout: '', stderr: ''});
    });
  });

  afterEach(async () => {
    execFileMock.mockReset();
    if (priorGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = priorGitConfigGlobal;
    await rm(root, {recursive: true, force: true});
  });

  it('writes a 0600 repository-scoped Authorization header config', async () => {
    const configPath = join(root, 'creds', 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'bearer',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });

    const content = await readFile(configPath, 'utf8');
    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(content).toContain('[http "https://github.com/acme/repo.git"]');
    expect(content).toContain('extraHeader = "Authorization: Bearer tok-123"');
    expect(content).not.toContain('[http]\n\tfollowRedirects = false');
  });

  it('accumulates credentials for multiple repositories in one config', async () => {
    const configPath = join(root, 'creds', 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/first.git',
      auth: {
        kind: 'bearer',
        token: 'first-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });
    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/second.git',
      auth: {
        kind: 'bearer',
        token: 'second-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });

    const content = await readFile(configPath, 'utf8');
    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(content.match(/\[http "/g)).toHaveLength(2);
    expect(content).toContain(
      '[http "https://github.com/acme/first.git"]\n\textraHeader = "Authorization: Bearer first-token"',
    );
    expect(content).toContain(
      '[http "https://github.com/acme/second.git"]\n\textraHeader = "Authorization: Bearer second-token"',
    );
  });

  it('keeps the first supplied Git author while accumulating later repositories', async () => {
    const configPath = join(root, 'creds', 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/initial.git',
      auth: {
        kind: 'bearer',
        token: 'initial-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });
    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/first.git',
      auth: {
        kind: 'bearer',
        token: 'first-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
      gitAuthor: {name: 'First Author', email: 'first@example.com'},
    });
    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/second.git',
      auth: {
        kind: 'bearer',
        token: 'second-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
      gitAuthor: {name: 'Second Author', email: 'second@example.com'},
    });

    const content = await readFile(configPath, 'utf8');
    expect(content.match(/\[user\]/g)).toHaveLength(1);
    expect(content).toContain('name = "First Author"');
    expect(content).not.toContain('name = "Second Author"');
  });

  it('recognizes a commented Git author section while accumulating repositories', async () => {
    const configPath = join(root, 'creds', 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/first.git',
      auth: {
        kind: 'bearer',
        token: 'first-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
      gitAuthor: {name: 'First Author', email: 'first@example.com'},
    });
    const initial = await readFile(configPath, 'utf8');
    await writeFile(configPath, initial.replace('[user]\n', '[user] # configured by the job\n'));

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/second.git',
      auth: {
        kind: 'bearer',
        token: 'second-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
      gitAuthor: {name: 'Second Author', email: 'second@example.com'},
    });

    const content = await readFile(configPath, 'utf8');
    expect(content.match(/^\[user\].*$/gm)).toHaveLength(1);
    expect(content).toContain('name = "First Author"');
    expect(content).not.toContain('name = "Second Author"');
  });

  it('includes the prior global config when it exists', async () => {
    const baseConfig = join(root, 'base.gitconfig');
    const configPath = join(root, 'git-cred.config');
    await writeFile(baseConfig, '[user]\n\tname = Runner\n');
    process.env.GIT_CONFIG_GLOBAL = baseConfig;

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'basic',
        username: 'x-token',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });

    const content = await readFile(configPath, 'utf8');
    const expected = Buffer.from('x-token:tok-123').toString('base64');
    expect(content).toContain(`[include]\n\tpath = "${baseConfig}"`);
    expect(content).toContain(`extraHeader = "Authorization: Basic ${expected}"`);
  });

  it('writes an exact, token-free credential helper configuration', async () => {
    const configPath = join(root, 'git-cred.config');

    await writeGitCredentialHelperConfig({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      helper: {
        command: 'node /opt/runner/dist/git-credential-helper.js',
        socketPath: join(root, 'credential.sock'),
        capability: 'job-capability',
      },
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain('[credential]\n\tuseHttpPath = true');
    expect(content).toContain('[credential "https://github.com/acme/repo/"]');
    expect(content).toContain(
      '\thelper = "!node /opt/runner/dist/git-credential-helper.js --socket',
    );
    expect(content).toContain('--capability job-capability');
    expect(content).not.toContain('password');
    expect(content).not.toContain('token');
  });

  it.each([
    ['control characters', 'job\ncapability'],
    ['oversized values', 'x'.repeat(513)],
  ])('rejects helper capabilities with %s', (_description, capability) => {
    expect(() =>
      writeGitCredentialHelperConfig({
        configPath: join(root, 'git-cred.config'),
        repositoryUrl: 'https://github.com/acme/repo.git',
        helper: {
          command: 'git-credential-shipfox',
          socketPath: join(root, 'credential.sock'),
          capability,
        },
      }),
    ).toThrow();
  });

  it('updates an existing helper without retaining credentials or duplicating identity', async () => {
    const configPath = join(root, 'git-cred.config');
    await writeFile(
      configPath,
      '[credential]\n\tuseHttpPath = true\n[credential "https://github.com/acme/repo.git"]\n\thelper = old-helper\n\tusername = old-user\n\tpassword = old-password\n[http "https://github.com/acme/repo.git"]\n\textraHeader = old-header\n[user]\n\tname = Existing Author\n\temail = existing@example.com\n',
    );
    mockExistingGitCredentialConfig();

    await writeGitCredentialHelperConfig({
      configPath,
      repositoryUrl: 'https://GITHUB.com:443/acme/repo.git',
      helper: {
        command: 'git-credential-shipfox',
        socketPath: join(root, 'credential.sock'),
        capability: 'job-capability',
      },
      gitAuthor: {name: 'Existing Author', email: 'existing@example.com'},
    });

    const content = await readFile(configPath, 'utf8');
    expect(content.match(/^[ \t]*helper = /gm)).toHaveLength(1);
    expect(content).not.toContain('old-helper');
    expect(content).not.toContain('old-password');
    expect(content).not.toContain('old-header');
    expect(content.match(/^\[user\]/gm)).toHaveLength(1);
    expect(content.match(/^\[credential\]$/gm)).toHaveLength(1);
  });

  it('removes a previous helper before writing an inline credential for the same repository', async () => {
    const configPath = join(root, 'git-cred.config');
    await writeFile(
      configPath,
      '[credential]\n\tuseHttpPath = true\n[credential "https://github.com/acme/repo.git"]\n\thelper = old-helper\n\tusername = old-user\n\tpassword = old-password\n',
    );
    mockExistingGitCredentialConfig();

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token: 'inline-token',
        expires_at: '2030-01-01T00:00:00.000Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });

    const content = await readFile(configPath, 'utf8');
    const expected = Buffer.from('x-access-token:inline-token').toString('base64');
    expect(content).not.toContain('old-helper');
    expect(content).not.toContain('old-password');
    expect(content).toContain(`extraHeader = "Authorization: Basic ${expected}"`);
  });

  it('adds the helper alongside a Git author and rejects persisted auth', async () => {
    const configPath = join(root, 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      credentialHelper: {
        command: 'git-credential-shipfox',
        socketPath: join(root, 'credential.sock'),
        capability: 'job-capability',
      },
      gitAuthor: {name: 'Helper Author', email: 'helper@example.com'},
    });
    const content = await readFile(configPath, 'utf8');
    expect(content).toContain('[user]\n\tname = "Helper Author"');

    expect(() =>
      writeAmbientGitCredential({
        configPath,
        repositoryUrl: 'https://github.com/acme/repo.git',
        auth: {
          kind: 'bearer',
          token: 'persisted-token',
          expires_at: '2026-01-01T00:00:00Z',
          carry: 'header',
          host: 'github.com',
          persist: true,
        },
        credentialHelper: {
          command: 'git-credential-shipfox',
          socketPath: join(root, 'credential.sock'),
          capability: 'job-capability',
        },
      }),
    ).toThrow(TypeError);
  });

  it('forces useHttpPath true after an existing false value', async () => {
    const configPath = join(root, 'git-cred.config');
    await writeFile(configPath, '[credential]\n\tuseHttpPath = true\n\tuseHttpPath = false\n');

    await writeGitCredentialHelperConfig({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      helper: {
        command: 'git-credential-shipfox',
        socketPath: join(root, 'credential.sock'),
        capability: 'job-capability',
      },
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain('\tuseHttpPath = false\n[credential]\n\tuseHttpPath = true');
  });

  it('scopes useHttpPath detection to the global credential section', async () => {
    const configPath = join(root, 'git-cred.config');
    await writeFile(
      configPath,
      '[credential "https://github.com/acme/other/"]\n\tuseHttpPath = true\n',
    );

    await writeGitCredentialHelperConfig({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      helper: {
        command: 'git-credential-shipfox',
        socketPath: join(root, 'credential.sock'),
        capability: 'job-capability',
      },
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain('[credential]\n\tuseHttpPath = true');
  });

  it('includes the prior global config when the helper config is whitespace-only', async () => {
    const baseConfig = join(root, 'base.gitconfig');
    const configPath = join(root, 'git-cred.config');
    await writeFile(baseConfig, '[user]\n\tname = Runner\n');
    await writeFile(configPath, ' \n\t');
    process.env.GIT_CONFIG_GLOBAL = baseConfig;

    await writeGitCredentialHelperConfig({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      helper: {
        command: 'git-credential-shipfox',
        socketPath: join(root, 'credential.sock'),
        capability: 'job-capability',
      },
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain(`[include]\n\tpath = "${baseConfig}"`);
  });

  it('writes the configured Git author identity without credentials', async () => {
    const configPath = join(root, 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      gitAuthor: {
        name: 'shipfox-test[bot]',
        email: '1+shipfox-test[bot]@users.noreply.github.com',
      },
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain(
      '[user]\n\tname = "shipfox-test[bot]"\n\temail = "1+shipfox-test[bot]@users.noreply.github.com"',
    );
    expect(content).not.toContain('extraHeader');
    expect(content).not.toContain('[http');
  });

  it('writes the configured Git author identity', async () => {
    const configPath = join(root, 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'bearer',
        token: 'tok-123',
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

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain(
      '[user]\n\tname = "shipfox-test[bot]"\n\temail = "1+shipfox-test[bot]@users.noreply.github.com"',
    );
  });

  it('preserves a persisted repository credential when adding an author without credentials', async () => {
    const configPath = join(root, 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'bearer',
        token: 'persisted-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });
    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      gitAuthor: {name: 'First Author', email: 'first@example.com'},
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain('extraHeader = "Authorization: Bearer persisted-token"');
    expect(content).toContain('name = "First Author"');
  });

  it('does not fall back to home config when GIT_CONFIG_GLOBAL points to a missing file', async () => {
    const configPath = join(root, 'git-cred.config');
    process.env.GIT_CONFIG_GLOBAL = join(root, 'missing.gitconfig');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'bearer',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).not.toContain('[include]');
  });

  it('quotes and escapes the persisted header value', async () => {
    const configPath = join(root, 'git-cred.config');

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl: 'https://github.com/acme/repo.git',
      auth: {
        kind: 'bearer',
        token: 'tok"#;\\tail',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain('extraHeader = "Authorization: Bearer tok\\"#;\\\\tail"');
  });

  it('rejects repository urls that would inject additional git config lines', async () => {
    await expect(
      writeAmbientGitCredential({
        configPath: join(root, 'git-cred.config'),
        repositoryUrl: 'https://github.com/acme/repo.git"\n[credential]\n\thelper = store',
        auth: {
          kind: 'bearer',
          token: 'tok-123',
          expires_at: '2026-01-01T00:00:00Z',
          carry: 'header',
          host: 'github.com',
          persist: true,
        },
      }),
    ).rejects.toThrow('Git config values must be single-line');
  });
});

describe('redactSecrets', () => {
  it('removes every occurrence of each secret', () => {
    expect(redactSecrets('token=abc and again abc', ['abc'])).toBe('token=*** and again ***');
  });

  it('strips URL-embedded credentials', () => {
    expect(redactSecrets('clone https://user:pass@github.com/x.git failed', [])).toBe(
      'clone https://***@github.com/x.git failed',
    );
  });

  it('ignores empty secrets', () => {
    expect(redactSecrets('unchanged', [''])).toBe('unchanged');
  });
});

describe('assertGitAvailable', () => {
  it('accepts git 2.31.0', async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (
        error: null,
        result: {stdout: string; stderr: string},
      ) => void;
      callback(null, {stdout: 'git version 2.31.0\n', stderr: ''});
    });

    const result = await assertGitAvailable();
    expect(result).toBe('git version 2.31.0');
  });

  it('rejects git versions older than 2.31.0', async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (
        error: null,
        result: {stdout: string; stderr: string},
      ) => void;
      callback(null, {stdout: 'git version 2.30.9\n', stderr: ''});
    });

    await expect(assertGitAvailable()).rejects.toThrow('Git 2.31.0 or newer is required');
  });
});
