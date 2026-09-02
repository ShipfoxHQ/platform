import {type ChildProcess, spawn} from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {delimiter, dirname, join} from 'node:path';
import {config} from '@shipfox/e2e-core';

const DEFAULT_SIGTERM_TIMEOUT_MS = 15_000;

export interface StartLocalRunnerParams {
  workspaceId: string;
  /** Manual registration token the runner exchanges at startup. */
  registrationToken: string;
  /** Labels the runner registers with. */
  labels: readonly string[];
  /** File that the child's stdout and stderr are appended to. */
  logFile: string;
  /** API URL the runner connects to. Defaults to the E2E API URL. */
  apiUrl?: string | undefined;
  /** Parent directory for per-job workspaces. Defaults to OS temp inside runner code. */
  workspaceRoot?: string | undefined;
  pollIntervalMs?: number | undefined;
  pollMaxIntervalMs?: number | undefined;
  pollMaxDurationMs?: number | undefined;
  /** Extra environment variables for one runner process. */
  extraEnv?: Record<string, string> | undefined;
  /** Overrides the resolved `@shipfox/runner` source entry (run via tsx). */
  entryPath?: string | undefined;
}

export interface LocalRunnerHandle {
  process: ChildProcess;
  pid: number;
  logFile: string;
  workspaceId: string;
  labels: readonly string[];
  credentialHelperBinDir?: string | undefined;
}

export interface StopLocalRunnerOptions {
  sigtermTimeoutMs?: number | undefined;
}

export interface LocalRunnerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface RunnerModule {
  /** Package directory used as the child's cwd for tsx and workspace-source resolution. */
  cwd: string;
  /** Source entry the child runs. */
  entry: string;
}

function resolveRunnerModule(): RunnerModule {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@shipfox/runner/package.json');
  const cwd = dirname(packageJsonPath);
  return {cwd, entry: join(cwd, 'src/index.ts')};
}

function inheritedProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'COMSPEC']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function buildRunnerEnv(
  params: StartLocalRunnerParams,
  credentialHelperBinDir: string | undefined,
): Record<string, string> {
  const inherited = inheritedProcessEnv();
  const renewableGitEnabled = params.extraEnv?.SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT === 'true';
  return {
    ...inherited,
    SHIPFOX_API_URL: params.apiUrl ?? config.API_URL,
    SHIPFOX_RUNNER_REGISTRATION_TOKEN: params.registrationToken,
    SHIPFOX_RUNNER_LABELS: params.labels.join(','),
    SHIPFOX_POLL_INTERVAL_MS: String(params.pollIntervalMs ?? 100),
    SHIPFOX_POLL_MAX_INTERVAL_MS: String(params.pollMaxIntervalMs ?? 500),
    SHIPFOX_POLL_MAX_DURATION_MS: String(params.pollMaxDurationMs ?? 300_000),
    ...(params.workspaceRoot !== undefined
      ? {SHIPFOX_RUNNER_WORKSPACE_ROOT: params.workspaceRoot}
      : {}),
    ...(credentialHelperBinDir
      ? {
          PATH: [credentialHelperBinDir, inherited.PATH].filter(Boolean).join(delimiter),
        }
      : {}),
    ...(renewableGitEnabled ? {GIT_CONFIG_NOSYSTEM: '1'} : {}),
    ...(params.extraEnv ?? {}),
  };
}

function createCredentialHelperBin(
  runnerModule: RunnerModule,
  params: StartLocalRunnerParams,
): string | undefined {
  if (params.extraEnv?.SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT !== 'true') return undefined;

  const helperTarget = join(runnerModule.cwd, 'dist', 'git-credential-helper.js');
  if (!existsSync(helperTarget)) {
    throw new Error(
      `The local runner credential helper is missing at ${helperTarget}; build @shipfox/runner before starting a renewable Git E2E runner.`,
    );
  }

  const helperBinDir = mkdtempSync(join(dirname(params.logFile), '.credential-helper-'));
  symlinkSync(helperTarget, join(helperBinDir, 'git-credential-shipfox'));
  return helperBinDir;
}

function removeCredentialHelperBin(helperBinDir: string | undefined): void {
  if (helperBinDir === undefined) return;
  rmSync(helperBinDir, {force: true, recursive: true});
}

export function localRunnerLogTail(path: string): string {
  try {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    const tail = lines.slice(-40).join('\n');
    return tail ? `\n\nLocal runner log tail:\n${tail}` : '';
  } catch {
    return '';
  }
}

export function startLocalRunner(params: StartLocalRunnerParams): LocalRunnerHandle {
  const runnerModule = params.entryPath
    ? {cwd: dirname(params.entryPath), entry: params.entryPath}
    : resolveRunnerModule();
  const {cwd, entry} = runnerModule;
  const credentialHelperBinDir = createCredentialHelperBin(runnerModule, params);

  const logFd = openSync(params.logFile, 'a');
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', '--conditions=workspace-source', entry], {
      cwd,
      stdio: ['ignore', logFd, logFd],
      env: buildRunnerEnv(params, credentialHelperBinDir),
    });
  } catch (error) {
    removeCredentialHelperBin(credentialHelperBinDir);
    throw error;
  } finally {
    closeSync(logFd);
  }

  const {pid} = child;
  if (pid === undefined) {
    child.kill('SIGKILL');
    removeCredentialHelperBin(credentialHelperBinDir);
    throw new Error('Local runner child process failed to start (no pid)');
  }

  child.once('exit', () => removeCredentialHelperBin(credentialHelperBinDir));

  return {
    process: child,
    pid,
    logFile: params.logFile,
    workspaceId: params.workspaceId,
    labels: params.labels,
    ...(credentialHelperBinDir ? {credentialHelperBinDir} : {}),
  };
}

export function waitForLocalRunnerExit(handle: LocalRunnerHandle): Promise<LocalRunnerExit> {
  if (handle.process.exitCode !== null || handle.process.signalCode !== null) {
    return Promise.resolve({
      code: handle.process.exitCode,
      signal: handle.process.signalCode,
    });
  }

  let onError: ((error: Error) => void) | undefined;
  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (onError) handle.process.removeListener('error', onError);
      if (onExit) handle.process.removeListener('exit', onExit);
    };
    onError = (error) => {
      cleanup();
      reject(new Error(`Local runner process error: ${error.message}`));
    };
    onExit = (code, signal) => {
      cleanup();
      resolve({code, signal});
    };
    handle.process.once('error', onError);
    handle.process.once('exit', onExit);
  });
}

function terminate(child: ChildProcess, sigtermTimeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      exited.then(resolve);
    }, sigtermTimeoutMs);
    exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function stopLocalRunner(
  handle: LocalRunnerHandle,
  options: StopLocalRunnerOptions = {},
): Promise<void> {
  try {
    await terminate(handle.process, options.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS);
  } finally {
    removeCredentialHelperBin(handle.credentialHelperBinDir);
  }
}
