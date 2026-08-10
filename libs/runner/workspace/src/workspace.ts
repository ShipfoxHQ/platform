import type {Dirent} from 'node:fs';
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, parse, resolve} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {isUuid} from '@shipfox/regex';
import {config} from '#config.js';

const RUNNER_LOGS_DIR = '.shipfox-runner-logs';
const RUNNER_CRED_DIR = '.shipfox-runner-cred';
const JOB_LOG_LOCK_SUFFIX = '.lock';
const JOB_LOG_LOCK_RETRY_MS = 10;

/**
 * Thrown when `SHIPFOX_RUNNER_WORKSPACE_ROOT` resolves to a path we refuse to
 * manage per-job directories under (empty, the filesystem root, or a home
 * directory). Surfaced at startup so the operator catches the misconfig at
 * deploy rather than as silent per-job failures.
 */
export class UnsafeWorkspaceRootError extends Error {
  constructor(public readonly root: string) {
    super(`Unsafe workspace root: ${root || '(empty)'}`);
    this.name = 'UnsafeWorkspaceRootError';
  }
}

/**
 * Thrown when a job's id is not the UUID the API contract guarantees, so it
 * cannot be used as the per-job directory name.
 */
export class InvalidJobIdError extends Error {
  constructor(public readonly jobId: string) {
    super(`Invalid job id: ${jobId}`);
    this.name = 'InvalidJobIdError';
  }
}

/**
 * Falls back to the OS temp directory when no root is configured. Only a
 * configured root is validated (throws {@link UnsafeWorkspaceRootError}); the
 * temp fallback is trusted. Pure: takes the raw configured value so the
 * path-safety logic is unit-testable without reading the environment; the
 * config-reading entry point is {@link resolveWorkspaceRootFromEnv}.
 */
export function resolveWorkspaceRoot(root: string | undefined): string {
  if (root === undefined) return tmpdir();

  if (root.trim() === '') throw new UnsafeWorkspaceRootError(root);

  const resolved = resolve(root);

  // A filesystem root ('/' on POSIX, 'C:\\' on Windows) has no parent and would
  // put job dirs at the top level. Never manage cleanup there.
  if (resolved === parse(resolved).root) throw new UnsafeWorkspaceRootError(root);

  // The home directory holds the operator's files; a stray recursive cleanup
  // there would be catastrophic.
  if (resolved === resolve(homedir())) throw new UnsafeWorkspaceRootError(root);

  return resolved;
}

export function resolveWorkspaceRootFromEnv(): string {
  return resolveWorkspaceRoot(config.SHIPFOX_RUNNER_WORKSPACE_ROOT);
}

/**
 * The deterministic per-job directory path. Pure: validates the id and builds the
 * path without touching the filesystem, so `runJob` can compute it up front (for
 * cleanup on every exit path) while the setup step owns the actual directory
 * creation. Throws {@link InvalidJobIdError} when the id is not the UUID the API
 * contract guarantees, since it is the only input to the path.
 */
export function jobWorkspacePath(jobId: string, root: string): string {
  if (!isUuid(jobId)) {
    throw new InvalidJobIdError(jobId);
  }
  return join(root, `job-${jobId}`);
}

export function jobLogsPath(jobId: string, root: string): string {
  if (!isUuid(jobId)) {
    throw new InvalidJobIdError(jobId);
  }
  return join(root, RUNNER_LOGS_DIR, `job-${jobId}`);
}

export function jobCredentialsPath(jobId: string, root: string): string {
  if (!isUuid(jobId)) {
    throw new InvalidJobIdError(jobId);
  }
  return join(root, RUNNER_CRED_DIR, `job-${jobId}`);
}

/**
 * Pre-cleans a per-job directory before recreating it, so a directory left by a
 * previous crash is never reused.
 */
async function resetDir(dir: string): Promise<void> {
  await rm(dir, {recursive: true, force: true});
  await mkdir(dir, {recursive: true});
}

/**
 * Run inside the setup step so a prep failure is reported through the step
 * protocol rather than bailing the job.
 */
export async function createJobDir(cwd: string): Promise<void> {
  await resetDir(cwd);
}

/**
 * Resets the runner-owned log directory before a job can reuse it after a crash.
 */
export async function createJobLogsDir(logsDir: string): Promise<void> {
  await withJobLogLock(logsDir, true, () => resetDir(logsDir));
}

/**
 * Removes only UUID-named per-job log directories left under the runner log root.
 * The log root itself and unrelated entries are preserved.
 */
export async function cleanupOrphanedJobLogs(root: string): Promise<void> {
  const logsRoot = join(root, RUNNER_LOGS_DIR);
  let entries: Dirent[];
  try {
    entries = await readdir(logsRoot, {withFileTypes: true});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger().warn({err, logsRoot}, 'Failed to sweep orphaned job logs');
    return;
  }

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith('job-') &&
          isUuid(entry.name.slice('job-'.length)),
      )
      .map((entry) =>
        withJobLogLock(join(logsRoot, entry.name), false, () =>
          cleanupJobLogs(join(logsRoot, entry.name)),
        ),
      ),
  );
}

/**
 * Coordinates the asynchronous orphan sweep with setup's pre-clean. A sweep
 * skips an active job, while setup waits for a sweep that already owns the
 * lock before recreating the directory. The pid makes locks left by a crashed
 * runner recoverable without weakening the mutual exclusion for live runners.
 */
async function withJobLogLock<T>(
  logsDir: string,
  waitForLock: boolean,
  action: () => Promise<T>,
): Promise<T | undefined> {
  const lockPath = `${logsDir}${JOB_LOG_LOCK_SUFFIX}`;
  await mkdir(dirname(logsDir), {recursive: true});

  while (true) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, {flag: 'wx'});
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      if (await isStaleJobLogLock(lockPath)) {
        await rm(lockPath, {force: true});
        continue;
      }
      if (!waitForLock) return undefined;

      await new Promise((resolve) => setTimeout(resolve, JOB_LOG_LOCK_RETRY_MS));
    }
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, {force: true});
  }
}

async function isStaleJobLogLock(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(lockPath, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }

  const pid = Number(raw.trim());
  if (!Number.isInteger(pid) || pid <= 0) return true;

  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * Never throws: failures are logged and swallowed so a dirty directory can't
 * mask the job result; the next createJobDir pre-clean reclaims it.
 */
export async function cleanupWorkspace(cwd: string): Promise<void> {
  try {
    await rm(cwd, {recursive: true, force: true});
  } catch (err) {
    logger().warn({err, cwd}, 'Failed to clean up job workspace');
  }
}

export async function cleanupJobLogs(logsDir: string): Promise<void> {
  try {
    await rm(logsDir, {recursive: true, force: true});
  } catch (err) {
    logger().warn({err, logsDir}, 'Failed to clean up job logs');
  }
}

export async function cleanupJobCredentials(credentialsDir: string): Promise<void> {
  try {
    await rm(credentialsDir, {recursive: true, force: true});
  } catch (err) {
    logger().warn({err, credentialsDir}, 'Failed to clean up job credentials');
  }
}
