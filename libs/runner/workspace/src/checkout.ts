import {execFile, spawn} from 'node:child_process';
import {access, chmod, mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';
import type {CheckoutTokenAuthDto} from '@shipfox/api-workflows-dto';

const execFileAsync = promisify(execFile);
const URL_CREDENTIAL_RE = /(https?:\/\/)[^/@\s]+@/gi;
const SHELL_SAFE_ARG_RE = /^[A-Za-z0-9_./:=@+-]+$/;
const GIT_VERSION_RE = /^git version (\d+)\.(\d+)\.(\d+)/;
const CONFIG_LINE_BREAK_RE = /[\r\n]/;
const MIN_GIT_VERSION = {major: 2, minor: 31, patch: 0};
const GIT_CONFIG_INDEXED_ENV_RE = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/;

/** Thrown when `git` is not on the runner host's PATH; surfaced as `git_unavailable`. */
export class GitUnavailableError extends Error {
  constructor(message = 'git is not available on the runner host', options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitUnavailableError';
  }
}

export type CheckoutOutputSink = (chunk: Buffer, source: 'stdout' | 'stderr') => void;

export type CheckoutPhase = 'init' | 'remote' | 'fetch' | 'checkout' | 'resolve';

/**
 * Why checkout failed, kept abstract here so the workspace layer does not depend on the
 * step-error DTO. The setup step maps each kind to a machine-readable `reason`.
 */
export type CheckoutFailureKind = 'auth' | 'unavailable' | 'failed' | 'aborted';

export class CheckoutError extends Error {
  public readonly phase: CheckoutPhase | undefined;

  constructor(
    public readonly kind: CheckoutFailureKind,
    message: string,
    options?: ErrorOptions & {phase?: CheckoutPhase | undefined},
  ) {
    super(message, options);
    this.name = 'CheckoutError';
    this.phase = options?.phase;
  }
}

export interface CheckoutCommandStartMetadata {
  readonly phase: CheckoutPhase;
  readonly command: string;
  readonly cwd: string;
}

/** Throws {@link GitUnavailableError} when `git` cannot be invoked on the host. */
export async function assertGitAvailable(): Promise<string> {
  try {
    const {stdout} = await execFileAsync('git', ['--version']);
    const version = stdout.trim();
    assertSupportedGitVersion(version);
    return version;
  } catch (error) {
    if (error instanceof GitUnavailableError) throw error;
    throw new GitUnavailableError('git is not available on the runner host', {cause: error});
  }
}

/**
 * Removes every occurrence of each secret plus any URL-embedded `user:pass@` credential
 * from `text`, so a checkout error never carries token material into a log or step result.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('***');
  }
  return redacted.replace(URL_CREDENTIAL_RE, '$1***@');
}

// git surfaces credential rejection and provider-availability failures only through
// stderr text, so classification is pattern-based. Auth wins over unavailable when both
// could match, since a rejected credential is the more actionable cause.
const AUTH_FAILURE =
  /authentication failed|could not read username|invalid username or password|terminal prompts disabled|403 forbidden|the requested url returned error: 40[13]|permission denied \(publickey\)|access denied/i;
const PROVIDER_UNAVAILABLE =
  /could not resolve host|could not connect|connection timed out|failed to connect|temporary failure in name resolution|the requested url returned error: (?:429|5\d\d)/i;

/**
 * Initializes `cwd` and checks out `ref` of `repositoryUrl` into it.
 *
 * The credential is injected through `GIT_CONFIG_*` environment entries, never argv or the
 * remote URL, so it is not persisted to `.git/config` and does not appear in process listings.
 * `GIT_TERMINAL_PROMPT=0` turns a missing or denied credential into an immediate error instead
 * of a hang on an interactive prompt. Failures are classified into a {@link CheckoutError}
 * and have any token material redacted from their message.
 */
export async function checkoutRepository(params: {
  repositoryUrl: string;
  ref: string;
  /** Number of commits to fetch; zero requests the full repository history. */
  fetchDepth?: number | undefined;
  auth?: CheckoutTokenAuthDto | undefined;
  cwd: string;
  signal?: AbortSignal | undefined;
  onOutput?: CheckoutOutputSink | undefined;
  onCommandStart?: ((metadata: CheckoutCommandStartMetadata) => void) | undefined;
  onSecrets?: ((secrets: string[]) => void) | undefined;
}): Promise<string> {
  const {
    repositoryUrl,
    ref,
    fetchDepth = 1,
    auth,
    cwd,
    signal,
    onCommandStart,
    onOutput,
    onSecrets,
  } = params;

  if (!Number.isInteger(fetchDepth) || fetchDepth < 0) {
    throw new RangeError('fetchDepth must be a non-negative integer');
  }
  const secrets = secretsOf(auth);
  onSecrets?.(secrets);

  try {
    await runGitCommand({
      phase: 'init',
      args: ['init'],
      displayArgs: ['init'],
      cwd,
      signal,
      onCommandStart,
      onOutput,
    });
    await runGitCommand({
      phase: 'remote',
      args: ['remote', 'add', 'origin', repositoryUrl],
      displayArgs: ['remote', 'add', 'origin', redactSecrets(repositoryUrl, secrets)],
      cwd,
      signal,
      onCommandStart,
      onOutput,
    });

    const fetchArgs = [
      'fetch',
      '--progress',
      '--no-tags',
      '--prune',
      ...(fetchDepth === 0 ? [] : [`--depth=${fetchDepth}`]),
      'origin',
      ref,
    ];
    await runGitCommand({
      phase: 'fetch',
      args: fetchArgs,
      displayArgs: fetchArgs,
      cwd,
      signal,
      onCommandStart,
      onOutput,
      ...(auth
        ? {
            configEnv: {
              GIT_CONFIG_COUNT: '2',
              GIT_CONFIG_KEY_0: `http.${repositoryUrl}.extraHeader`,
              GIT_CONFIG_VALUE_0: `Authorization: ${authorizationValue(auth)}`,
              GIT_CONFIG_KEY_1: 'http.followRedirects',
              GIT_CONFIG_VALUE_1: 'false',
            },
          }
        : {}),
    });
    await runGitCommand({
      phase: 'checkout',
      args: ['checkout', '--progress', '--force', 'FETCH_HEAD'],
      displayArgs: ['checkout', '--progress', '--force', 'FETCH_HEAD'],
      cwd,
      signal,
      onCommandStart,
      onOutput,
    });
    const {stdout} = await runGitCommand({
      phase: 'resolve',
      args: ['rev-parse', 'HEAD'],
      displayArgs: ['rev-parse', 'HEAD'],
      cwd,
      signal,
      onCommandStart,
      onOutput,
    });
    return stdout.trim();
  } catch (error) {
    throw classifyCheckoutError(error, auth);
  }
}

export async function writeAmbientGitCredential(params: {
  configPath: string;
  repositoryUrl: string;
  auth: CheckoutTokenAuthDto;
  gitAuthor?: {name: string; email: string} | undefined;
}): Promise<void> {
  const {configPath, repositoryUrl, auth, gitAuthor} = params;
  const includePath = await ambientIncludePath();
  const lines = [
    ...(includePath ? ['[include]', `\tpath = ${gitConfigQuotedValue(includePath)}`] : []),
    ...(gitAuthor
      ? [
          '[user]',
          `\tname = ${gitConfigQuotedValue(gitAuthor.name)}`,
          `\temail = ${gitConfigQuotedValue(gitAuthor.email)}`,
        ]
      : []),
    `[http "${gitConfigSubsection(repositoryUrl)}"]`,
    `\textraHeader = ${gitConfigQuotedValue(`Authorization: ${authorizationValue(auth)}`)}`,
    '[http]',
    '\tfollowRedirects = false',
    '',
  ];

  await mkdir(dirname(configPath), {recursive: true});
  await writeFile(configPath, lines.join('\n'), {mode: 0o600});
  await chmod(configPath, 0o600);
}

function basicCredential(auth: {username: string; token: string}): string {
  return Buffer.from(`${auth.username}:${auth.token}`).toString('base64');
}

function authorizationValue(auth: CheckoutTokenAuthDto): string {
  if (auth.kind === 'bearer') return `Bearer ${auth.token}`;
  return `Basic ${basicCredential(auth)}`;
}

// Every form the credential takes on the wire is secret. For basic auth the raw token is
// not a substring of the base64 the header carries, so redacting only the token would
// leak the base64; include it explicitly.
function secretsOf(auth: CheckoutTokenAuthDto | undefined): string[] {
  if (!auth) return [];
  if (auth.kind === 'bearer') return [auth.token];
  return [auth.token, basicCredential(auth)];
}

function classifyCheckoutError(
  error: unknown,
  auth: CheckoutTokenAuthDto | undefined,
): CheckoutError {
  if (isAbortError(error)) {
    return new CheckoutError('aborted', 'Checkout aborted', {cause: error, phase: phaseOf(error)});
  }

  const secrets = secretsOf(auth);
  const stderr = stderrOf(error);
  const message = redactSecrets(stderr.trim() || errorMessage(error), secrets);
  // Raw process errors can carry provider output or credential-bearing URLs, so
  // the cause chain is rebuilt before it can ride into a logger unredacted.
  const cause = redactedCause(error, secrets);

  const phase = phaseOf(error);

  if (AUTH_FAILURE.test(stderr)) return new CheckoutError('auth', message, {cause, phase});
  if (PROVIDER_UNAVAILABLE.test(stderr)) {
    return new CheckoutError('unavailable', message, {cause, phase});
  }
  return new CheckoutError('failed', message, {cause, phase});
}

function runGitCommand(params: {
  phase: CheckoutPhase;
  args: string[];
  displayArgs: string[];
  cwd: string;
  configEnv?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  onOutput?: CheckoutOutputSink | undefined;
  onCommandStart?: ((metadata: CheckoutCommandStartMetadata) => void) | undefined;
}): Promise<{stdout: string; stderr: string}> {
  const {phase, args, displayArgs, cwd, configEnv, signal, onCommandStart, onOutput} = params;
  onCommandStart?.({phase, command: formatGitCommand(displayArgs), cwd});

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: gitCommandEnv(configEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? {signal} : {}),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      onOutput?.(chunk, 'stdout');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      onOutput?.(chunk, 'stderr');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(new GitSpawnError(phase, error));
    });

    child.on('close', (code, signalName) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({stdout, stderr});
        return;
      }
      reject(new GitCommandError(phase, stderr, code, signalName));
    });
  });
}

function gitCommandEnv(configEnv: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env = {...process.env};
  delete env.GIT_CONFIG_PARAMETERS;
  for (const key of Object.keys(env)) {
    if (GIT_CONFIG_INDEXED_ENV_RE.test(key)) delete env[key];
  }
  return {...env, GIT_TERMINAL_PROMPT: '0', ...configEnv};
}

class GitSpawnError extends Error {
  constructor(
    public readonly phase: CheckoutPhase,
    error: Error,
  ) {
    super(error.message, {cause: error});
    this.name = error.name;
  }
}

class GitCommandError extends Error {
  constructor(
    public readonly phase: CheckoutPhase,
    public readonly stderr: string,
    public readonly code: number | null,
    public readonly signal: NodeJS.Signals | null,
  ) {
    super('Git command failed');
    this.name = 'GitCommandError';
  }
}

function phaseOf(error: unknown): CheckoutPhase | undefined {
  if (error instanceof GitCommandError) return error.phase;
  if (error && typeof error === 'object' && 'phase' in error) {
    const {phase} = error as {phase?: unknown};
    if (
      phase === 'init' ||
      phase === 'remote' ||
      phase === 'fetch' ||
      phase === 'checkout' ||
      phase === 'resolve'
    ) {
      return phase;
    }
  }
  return undefined;
}

function formatGitCommand(args: string[]): string {
  return `git ${args.map(shellQuote).join(' ')}`;
}

function shellQuote(value: string): string {
  if (SHELL_SAFE_ARG_RE.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Rebuilds the failure cause with every secret stripped from its message, preserving the
// original error name for diagnostics while guaranteeing no credential survives on it.
function redactedCause(error: unknown, secrets: string[]): Error {
  const scrubbed = new Error(redactSecrets(errorMessage(error), secrets));
  if (error instanceof Error) scrubbed.name = error.name;
  return scrubbed;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function stderrOf(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const {stderr} = error as {stderr?: unknown};
    if (typeof stderr === 'string') return stderr;
    if (Buffer.isBuffer(stderr)) return stderr.toString();
  }
  return '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSupportedGitVersion(version: string): void {
  const parsed = GIT_VERSION_RE.exec(version);
  if (!parsed) {
    throw new GitUnavailableError(`Unsupported Git version output: ${version}`);
  }

  const [, majorRaw, minorRaw, patchRaw] = parsed;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (isAtLeastVersion({major, minor, patch}, MIN_GIT_VERSION)) return;

  throw new GitUnavailableError(
    `Git ${formatVersion(MIN_GIT_VERSION)} or newer is required on the runner host; found ${major}.${minor}.${patch}`,
  );
}

function isAtLeastVersion(
  value: {major: number; minor: number; patch: number},
  minimum: {major: number; minor: number; patch: number},
): boolean {
  if (value.major !== minimum.major) return value.major > minimum.major;
  if (value.minor !== minimum.minor) return value.minor > minimum.minor;
  return value.patch >= minimum.patch;
}

function formatVersion(version: {major: number; minor: number; patch: number}): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

async function ambientIncludePath(): Promise<string | undefined> {
  const prior = process.env.GIT_CONFIG_GLOBAL;
  if (prior) return (await pathExists(prior)) ? prior : undefined;

  const homeConfig = join(homedir(), '.gitconfig');
  return (await pathExists(homeConfig)) ? homeConfig : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function gitConfigSubsection(value: string): string {
  assertSingleLineGitConfigValue(value);
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function gitConfigQuotedValue(value: string): string {
  assertSingleLineGitConfigValue(value);
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\t', '\\t')
    .replaceAll('\b', '\\b')}"`;
}

function assertSingleLineGitConfigValue(value: string): void {
  if (CONFIG_LINE_BREAK_RE.test(value)) {
    throw new Error('Git config values must be single-line');
  }
}
