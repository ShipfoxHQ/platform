import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  cleanupJobAgentState,
  cleanupJobCredentials,
  cleanupJobLogs,
  cleanupOrphanedJobLogs,
  cleanupWorkspace,
  createJobAgentStateDir,
  createJobDir,
  createJobLogsDir,
  InvalidJobIdError,
  jobAgentStatePath,
  jobCredentialsPath,
  jobLogsPath,
  jobWorkspacePath,
  resolveWorkspaceRoot,
  UnsafeWorkspaceRootError,
} from '#workspace.js';

describe('resolveWorkspaceRoot', () => {
  it('returns the configured root when set', () => {
    const root = resolveWorkspaceRoot('/var/shipfox/work');

    expect(root).toBe('/var/shipfox/work');
  });

  it('falls back to the OS temp dir when unset', () => {
    const root = resolveWorkspaceRoot(undefined);

    expect(root).toBe(tmpdir());
  });

  it.each(['', '   '])('rejects an empty/whitespace root (%j)', (value) => {
    const resolveRoot = () => resolveWorkspaceRoot(value);

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });

  it('rejects the filesystem root', () => {
    const resolveRoot = () => resolveWorkspaceRoot('/');

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });

  it('rejects the home directory', () => {
    const resolveRoot = () => resolveWorkspaceRoot(homedir());

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });
});

describe('jobWorkspacePath', () => {
  const root = '/var/shipfox/work';

  it('names the directory after the job id under the root', () => {
    const jobId = '44444444-4444-4444-8444-444444444444';

    const cwd = jobWorkspacePath(jobId, root);

    expect(cwd).toBe(join(root, `job-${jobId}`));
  });

  it('rejects a job id that is not a UUID', () => {
    const resolve = () => jobWorkspacePath('../../etc/passwd', root);

    expect(resolve).toThrow(InvalidJobIdError);
  });
});

describe('jobLogsPath', () => {
  const root = '/var/shipfox/work';

  it('names the runner-owned log directory after the job id under the root', () => {
    const jobId = '55555555-5555-4555-8555-555555555555';

    const logsDir = jobLogsPath(jobId, root);

    expect(logsDir).toBe(join(root, '.shipfox-runner-logs', `job-${jobId}`));
  });

  it('rejects a job id that is not a UUID', () => {
    const resolve = () => jobLogsPath('../../etc/passwd', root);

    expect(resolve).toThrow(InvalidJobIdError);
  });
});

describe('jobAgentStatePath', () => {
  const root = '/var/shipfox/work';

  it('names the runner-owned agent-state directory after the job id under the root', () => {
    const jobId = '55555555-5555-4555-8555-555555555555';

    const agentStateDir = jobAgentStatePath(jobId, root);

    expect(agentStateDir).toBe(join(root, '.shipfox-runner-agent', `job-${jobId}`));
  });

  it('rejects a job id that is not a UUID', () => {
    const resolve = () => jobAgentStatePath('../../etc/passwd', root);

    expect(resolve).toThrow(InvalidJobIdError);
  });
});

describe('jobCredentialsPath', () => {
  const root = '/var/shipfox/work';

  it('names the runner-owned credential directory after the job id under the root', () => {
    const jobId = '66666666-6666-4666-8666-666666666666';

    const credentialsDir = jobCredentialsPath(jobId, root);

    expect(credentialsDir).toBe(join(root, '.shipfox-runner-cred', `job-${jobId}`));
  });

  it('rejects a job id that is not a UUID', () => {
    const resolve = () => jobCredentialsPath('../../etc/passwd', root);

    expect(resolve).toThrow(InvalidJobIdError);
  });
});

describe('createJobDir', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-ws-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('creates the per-job directory', async () => {
    const cwd = join(root, 'job-11111111-1111-4111-8111-111111111111');

    await createJobDir(cwd);

    expect((await stat(cwd)).isDirectory()).toBe(true);
  });

  it('pre-cleans a dirty directory left from a previous run', async () => {
    const cwd = join(root, 'job-22222222-2222-4222-8222-222222222222');
    await createJobDir(cwd);
    await writeFile(join(cwd, 'stale.txt'), 'leftover');

    await createJobDir(cwd);

    const readStale = () => stat(join(cwd, 'stale.txt'));
    await expect(readStale()).rejects.toThrow();
  });
});

describe('createJobLogsDir', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-job-logs-create-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('creates the per-job log directory', async () => {
    const logsDir = join(root, 'job-11111111-1111-4111-8111-111111111111');

    await createJobLogsDir(logsDir);

    expect((await stat(logsDir)).isDirectory()).toBe(true);
  });

  it('pre-cleans a dirty directory left from a previous run', async () => {
    const logsDir = join(root, 'job-22222222-2222-4222-8222-222222222222');
    await createJobLogsDir(logsDir);
    await writeFile(join(logsDir, 'stale.ndjson'), '{}\n');

    await createJobLogsDir(logsDir);

    const readStale = () => stat(join(logsDir, 'stale.ndjson'));
    await expect(readStale()).rejects.toThrow();
  });
});

describe('createJobAgentStateDir', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-job-agent-state-create-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('creates the per-job agent-state directory', async () => {
    const agentStateDir = join(root, 'job-11111111-1111-4111-8111-111111111111');

    await createJobAgentStateDir(agentStateDir);

    expect((await stat(agentStateDir)).isDirectory()).toBe(true);
  });

  it('pre-cleans a dirty directory left from a previous run', async () => {
    const agentStateDir = join(root, 'job-22222222-2222-4222-8222-222222222222');
    await createJobAgentStateDir(agentStateDir);
    await writeFile(join(agentStateDir, 'stale.jsonl'), '{}\n');

    await createJobAgentStateDir(agentStateDir);

    const readStale = () => stat(join(agentStateDir, 'stale.jsonl'));
    await expect(readStale()).rejects.toThrow();
  });
});

describe('cleanupOrphanedJobLogs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-job-logs-sweep-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('removes UUID-named job directories and preserves unrelated entries', async () => {
    const logsRoot = join(root, '.shipfox-runner-logs');
    const orphan = join(logsRoot, 'job-33333333-3333-4333-8333-333333333333');
    const otherJob = join(logsRoot, 'job-not-a-uuid');
    const unrelatedUuidDir = join(logsRoot, 'other-33333333-3333-4333-8333-333333333333');
    const file = join(logsRoot, 'README');
    await mkdir(orphan, {recursive: true});
    await writeFile(join(orphan, 'setup.ndjson'), '{}\n');
    await mkdir(otherJob, {recursive: true});
    await mkdir(unrelatedUuidDir, {recursive: true});
    await writeFile(file, 'keep');

    await cleanupOrphanedJobLogs(root);

    await expect(stat(orphan)).rejects.toThrow();
    expect((await stat(otherJob)).isDirectory()).toBe(true);
    expect((await stat(unrelatedUuidDir)).isDirectory()).toBe(true);
    expect((await stat(file)).isFile()).toBe(true);
    expect((await stat(logsRoot)).isDirectory()).toBe(true);
  });

  it('does not throw when the runner log root is missing', async () => {
    await expect(cleanupOrphanedJobLogs(root)).resolves.toBeUndefined();
  });

  it('preserves a job directory while the job owns its log lock', async () => {
    const logsRoot = join(root, '.shipfox-runner-logs');
    const orphan = join(logsRoot, 'job-44444444-4444-4444-8444-444444444444');
    await mkdir(orphan, {recursive: true});
    await writeFile(join(orphan, 'setup.ndjson'), '{}\n');
    await writeFile(`${orphan}.lock`, `${process.pid}\n`);

    await cleanupOrphanedJobLogs(root);

    expect((await stat(orphan)).isDirectory()).toBe(true);
    await rm(`${orphan}.lock`, {force: true});
    await cleanupOrphanedJobLogs(root);
    await expect(stat(orphan)).rejects.toThrow();
  });

  it('reclaims a lock left by a dead or invalid owner', async () => {
    const logsRoot = join(root, '.shipfox-runner-logs');
    const orphan = join(logsRoot, 'job-55555555-5555-4555-8555-555555555555');
    await mkdir(orphan, {recursive: true});
    await writeFile(`${orphan}.lock`, 'not-a-live-owner');

    await cleanupOrphanedJobLogs(root);

    await expect(stat(orphan)).rejects.toThrow();
    await expect(stat(`${orphan}.lock`)).rejects.toThrow();
    await expect(stat(`${orphan}.lock.reclaim`)).rejects.toThrow();
  });
});

describe('cleanupWorkspace', () => {
  it('does not throw when the directory is missing', async () => {
    const missing = join(tmpdir(), 'shipfox-job-does-not-exist-xyz');

    const result = await cleanupWorkspace(missing);

    expect(result).toBeUndefined();
  });
});

describe('cleanupJobLogs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-job-logs-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('removes an existing job log directory without touching the root', async () => {
    const logsDir = join(root, 'job-33333333-3333-4333-8333-333333333333');
    await mkdir(logsDir, {recursive: true});
    await writeFile(join(logsDir, 'setup.ndjson'), '{}\n');

    const result = await cleanupJobLogs(logsDir);

    const readLogsDir = () => stat(logsDir);
    await expect(readLogsDir()).rejects.toThrow();
    expect((await stat(root)).isDirectory()).toBe(true);
    expect(result).toBeUndefined();
  });

  it('does not throw when the directory is missing', async () => {
    const missing = join(root, 'shipfox-job-logs-does-not-exist-xyz');

    const result = await cleanupJobLogs(missing);

    expect(result).toBeUndefined();
  });
});

describe('cleanupJobAgentState', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-job-agent-state-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('removes an existing job agent-state directory without touching the root', async () => {
    const agentStateDir = join(root, 'job-33333333-3333-4333-8333-333333333333');
    await mkdir(agentStateDir, {recursive: true});
    await writeFile(join(agentStateDir, 'sessions.ndjson'), '{}\n');

    const result = await cleanupJobAgentState(agentStateDir);

    const readAgentStateDir = () => stat(agentStateDir);
    await expect(readAgentStateDir()).rejects.toThrow();
    expect((await stat(root)).isDirectory()).toBe(true);
    expect(result).toBeUndefined();
  });

  it('does not throw when the directory is missing', async () => {
    const missing = join(root, 'shipfox-job-agent-state-does-not-exist-xyz');

    const result = await cleanupJobAgentState(missing);

    expect(result).toBeUndefined();
  });
});

describe('cleanupJobCredentials', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-job-cred-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('removes an existing job credential directory without touching the root', async () => {
    const credentialsDir = join(root, 'job-77777777-7777-4777-8777-777777777777');
    await mkdir(credentialsDir, {recursive: true});
    await writeFile(join(credentialsDir, 'git-cred.config'), '[http]\n');

    const result = await cleanupJobCredentials(credentialsDir);

    const readCredentialsDir = () => stat(credentialsDir);
    await expect(readCredentialsDir()).rejects.toThrow();
    expect((await stat(root)).isDirectory()).toBe(true);
    expect(result).toBeUndefined();
  });

  it('does not throw when the directory is missing', async () => {
    const missing = join(root, 'shipfox-job-cred-does-not-exist-xyz');

    const result = await cleanupJobCredentials(missing);

    expect(result).toBeUndefined();
  });
});
