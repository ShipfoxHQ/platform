import {randomUUID} from 'node:crypto';
import type {Dirent} from 'node:fs';
import {link, mkdir, readdir, readFile, readlink, rm, symlink, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, parse, resolve} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {isUuid} from '@shipfox/regex';
import {config} from '#config.js';

const RUNNER_LOGS_DIR = '.shipfox-runner-logs';
const RUNNER_AGENT_STATE_DIR = '.shipfox-runner-agent';
const RUNNER_CRED_DIR = '.shipfox-runner-cred';
const JOB_DIRECTORY_LOCK_SUFFIX = '.lock';
const JOB_DIRECTORY_LOCK_RETRY_MS = 10;
export const RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR = '/tmp/shipfox-runner-credentials';
const FALLBACK_CREDENTIAL_SOCKET_SUFFIX = '.sock';
const FALLBACK_CREDENTIAL_SOCKET_OWNER_SUFFIX = '.owner';
const FALLBACK_CREDENTIAL_SOCKET_LOCK_SUFFIX = '.lock';
const FALLBACK_CREDENTIAL_SOCKET_ENTRY_RE = /^(?<capability>[0-9a-f-]+)\.sock(?:\.owner|\.lock)?$/u;

export function runnerFallbackCredentialSocketPath(capability: string): string {
  assertUuidCapability(capability);
  return join(
    RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR,
    `${capability}${FALLBACK_CREDENTIAL_SOCKET_SUFFIX}`,
  );
}

export function runnerFallbackCredentialSocketOwnerPath(capability: string): string {
  assertUuidCapability(capability);
  return join(
    RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR,
    `${capability}${FALLBACK_CREDENTIAL_SOCKET_SUFFIX}${FALLBACK_CREDENTIAL_SOCKET_OWNER_SUFFIX}`,
  );
}

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

export function jobAgentStatePath(jobId: string, root: string): string {
  if (!isUuid(jobId)) {
    throw new InvalidJobIdError(jobId);
  }
  return join(root, RUNNER_AGENT_STATE_DIR, `job-${jobId}`);
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
  await withJobDirectoryLock(logsDir, true, () => resetDir(logsDir));
}

/**
 * Pre-cleans the runner-owned agent-state directory before recreating it, so a
 * directory left by a previous crash is never reused. The lock coordinates
 * setup with the startup orphan sweep. The returned release function keeps the
 * lock held while the job uses the directory; callers must release it after
 * the job's final cleanup.
 */
export async function createJobAgentStateDir(agentStateDir: string): Promise<() => Promise<void>> {
  const release = await acquireJobDirectoryLock(agentStateDir, true);
  if (release === undefined) {
    throw new Error('Failed to acquire the job agent-state lock');
  }

  try {
    await resetDir(agentStateDir);
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * Pre-cleans the runner-owned credential directory and keeps its lock held for
 * the lifetime of the job. The startup sweep uses the same lock, so it cannot
 * remove a live broker socket or helper configuration.
 */
export async function createJobCredentialsDir(
  credentialsDir: string,
): Promise<() => Promise<void>> {
  const release = await acquireJobDirectoryLock(credentialsDir, true);
  if (release === undefined) {
    throw new Error('Failed to acquire the job credential lock');
  }

  try {
    await resetDir(credentialsDir);
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * Removes only UUID-named per-job directories left under a runner-owned root.
 * The root itself and unrelated entries are preserved.
 */
export async function cleanupOrphanedJobLogs(root: string): Promise<void> {
  await cleanupOrphanedJobDirectories(
    root,
    RUNNER_LOGS_DIR,
    cleanupJobLogs,
    'Failed to sweep orphaned job logs',
  );
}

export async function cleanupOrphanedJobAgentState(root: string): Promise<void> {
  await cleanupOrphanedJobDirectories(
    root,
    RUNNER_AGENT_STATE_DIR,
    cleanupJobAgentState,
    'Failed to sweep orphaned job agent state',
  );
}

export async function cleanupOrphanedJobCredentials(root: string): Promise<void> {
  await cleanupOrphanedJobDirectories(
    root,
    RUNNER_CRED_DIR,
    cleanupJobCredentials,
    'Failed to sweep orphaned job credentials',
  );
  await cleanupOrphanedFallbackCredentialSockets();
}

async function cleanupOrphanedFallbackCredentialSockets(): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR, {withFileTypes: true});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger().warn(
      {err: error, fallbackSocketDir: RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR},
      'Failed to sweep fallback credential sockets',
    );
    return;
  }

  const capabilities = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSocket()) continue;
    const match = FALLBACK_CREDENTIAL_SOCKET_ENTRY_RE.exec(entry.name);
    const capability = match?.groups?.capability;
    if (capability !== undefined && isUuid(capability)) capabilities.add(capability);
  }

  await Promise.all(
    [...capabilities].map((capability) => cleanupFallbackCredentialSocket(capability)),
  );
}

async function cleanupFallbackCredentialSocket(capability: string): Promise<void> {
  const socketPath = runnerFallbackCredentialSocketPath(capability);
  const ownerPath = runnerFallbackCredentialSocketOwnerPath(capability);
  const lockPath = `${socketPath}${FALLBACK_CREDENTIAL_SOCKET_LOCK_SUFFIX}`;
  let owner: string | undefined;
  try {
    owner = (await readFile(ownerPath, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger().warn({err: error, ownerPath}, 'Failed to inspect fallback credential socket owner');
      return;
    }
  }

  if (owner !== undefined && !isProcessDead(Number(owner.split(':', 1)[0]))) return;

  try {
    await rm(socketPath, {force: true});
    await rm(ownerPath, {force: true});
    await rm(lockPath, {force: true});
  } catch (error) {
    logger().warn({err: error, socketPath}, 'Failed to remove orphaned fallback credential socket');
  }
}

async function cleanupOrphanedJobDirectories(
  root: string,
  directoryName: string,
  cleanupJob: (jobDir: string) => Promise<void>,
  failureMessage: string,
): Promise<void> {
  const jobsRoot = join(root, directoryName);
  let entries: Dirent[];
  try {
    entries = await readdir(jobsRoot, {withFileTypes: true});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger().warn({err, jobsRoot}, failureMessage);
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
        withJobDirectoryLock(join(jobsRoot, entry.name), false, () =>
          cleanupJob(join(jobsRoot, entry.name)),
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
async function withJobDirectoryLock<T>(
  jobDir: string,
  waitForLock: boolean,
  action: () => Promise<T>,
): Promise<T | undefined> {
  const release = await acquireJobDirectoryLock(jobDir, waitForLock);
  if (release === undefined) return undefined;

  try {
    return await action();
  } finally {
    await release();
  }
}

async function acquireJobDirectoryLock(
  jobDir: string,
  waitForLock: boolean,
): Promise<(() => Promise<void>) | undefined> {
  const lockPath = `${jobDir}${JOB_DIRECTORY_LOCK_SUFFIX}`;
  await mkdir(dirname(jobDir), {recursive: true});

  while (true) {
    if (await tryAcquireJobDirectoryLock(lockPath)) {
      break;
    }

    const existingLock = await readJobDirectoryLock(lockPath);
    if (existingLock === undefined) continue;
    if (
      isProcessDead(existingLock.pid) &&
      (await tryReclaimStaleJobDirectoryLock(lockPath, existingLock.raw))
    ) {
      continue;
    }
    if (!waitForLock) return undefined;

    await new Promise((resolve) => setTimeout(resolve, JOB_DIRECTORY_LOCK_RETRY_MS));
  }

  let released = false;
  return async () => {
    if (released) return;
    await rm(lockPath, {force: true});
    released = true;
  };
}

type JobDirectoryLock = {
  pid: number;
  raw: string;
};

async function tryAcquireJobDirectoryLock(lockPath: string): Promise<boolean> {
  const lockOwner = `${process.pid}:${randomUUID()}`;
  const temporaryLockPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryLockPath, lockOwner, {flag: 'wx'});
    try {
      await link(temporaryLockPath, lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return false;
    }
  } finally {
    await rm(temporaryLockPath, {force: true});
  }
}

async function readJobDirectoryLock(lockPath: string): Promise<JobDirectoryLock | undefined> {
  let raw: string;
  try {
    raw = (await readFile(lockPath, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  const pid = Number(raw.split(':', 1)[0]);
  return {pid, raw};
}

function isProcessDead(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;

  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function assertUuidCapability(capability: string): void {
  if (!isUuid(capability)) throw new TypeError('Credential socket capability must be a UUID');
}

/**
 * Claims stale-lock reclamation with an atomic symlink. The claim records the
 * reclaimer pid, so another process can safely take over if the reclaimer
 * crashes; no process unlinks the lock after a separate liveness check.
 */
async function tryReclaimStaleJobDirectoryLock(
  lockPath: string,
  expectedLock: string,
): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;

  while (true) {
    try {
      // A symlink is created atomically, and its target publishes the full
      // reclaimer token before another process can observe the claim.
      await symlink(`${process.pid}:${randomUUID()}`, reclaimPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await isStaleReclaimer(reclaimPath))) return false;
      await rm(reclaimPath, {force: true});
    }
  }

  try {
    const currentLock = await readJobDirectoryLock(lockPath);
    if (currentLock?.raw !== expectedLock) return false;

    try {
      await rm(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return true;
  } finally {
    await rm(reclaimPath, {force: true});
  }
}

async function isStaleReclaimer(reclaimPath: string): Promise<boolean> {
  let target: string;
  try {
    target = await readlink(reclaimPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }

  return isProcessDead(Number(target.split(':', 1)[0]));
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

export async function cleanupJobAgentState(agentStateDir: string): Promise<void> {
  try {
    await rm(agentStateDir, {recursive: true, force: true});
  } catch (err) {
    logger().warn({err, agentStateDir}, 'Failed to clean up job agent state');
  }
}

export async function cleanupJobCredentials(credentialsDir: string): Promise<void> {
  try {
    await rm(credentialsDir, {recursive: true, force: true});
  } catch (err) {
    logger().warn({err, credentialsDir}, 'Failed to clean up job credentials');
  }
}
