import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {
  assertGitAvailable,
  CheckoutError,
  checkoutRepository,
  writeAmbientGitCredential,
} from '#checkout.js';

// Exercises checkoutRepository against a real local git remote (file://), so an argv or
// flag mistake a mock would accept fails here. git is a runner host prerequisite, so it is
// present in CI. Only the network/auth/abort paths (which a local remote cannot produce)
// stay mocked in checkout.test.ts.
const execFileAsync = promisify(execFile);
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const GIT_VERSION_RE = /^git version /;

let workdir: string;
let sourceRepo: string;
let cwd: string;

async function git(args: string[], dir: string): Promise<void> {
  await execFileAsync('git', args, {cwd: dir});
}

async function gitOutput(args: string[], dir: string): Promise<string> {
  const {stdout} = await execFileAsync('git', args, {cwd: dir});
  return stdout.trim();
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'shipfox-checkout-'));

  sourceRepo = join(workdir, 'source');
  await mkdir(sourceRepo, {recursive: true});
  await git(['init', '-b', 'main'], sourceRepo);
  await git(['config', 'user.email', 'test@shipfox.io'], sourceRepo);
  await git(['config', 'user.name', 'Test'], sourceRepo);
  // Override a host/global commit.gpgsign=true: the throwaway repo has no signing key.
  await git(['config', 'commit.gpgsign', 'false'], sourceRepo);
  await writeFile(join(sourceRepo, 'README.md'), '# hello\n');
  await git(['add', '.'], sourceRepo);
  await git(['commit', '-m', 'initial'], sourceRepo);

  cwd = join(workdir, 'job-1');
  await mkdir(cwd, {recursive: true});
});

afterEach(async () => {
  await rm(workdir, {recursive: true, force: true});
});

describe('checkoutRepository (real git)', () => {
  it('checks out the requested ref into the per-job directory', async () => {
    const commit = await checkoutRepository({
      repositoryUrl: `file://${sourceRepo}`,
      ref: 'main',
      cwd,
    });

    const readme = await readFile(join(cwd, 'README.md'), 'utf8');
    expect(readme).toBe('# hello\n');
    expect(commit).toMatch(COMMIT_SHA_RE);
  });
  it('fetches the full history when fetch depth is zero', async () => {
    await writeFile(join(sourceRepo, 'README.md'), '# hello\nsecond commit\n');
    await git(['add', '.'], sourceRepo);
    await git(['commit', '-m', 'second'], sourceRepo);

    const fullHistoryCwd = join(workdir, 'job-full-history');
    await mkdir(fullHistoryCwd, {recursive: true});
    await checkoutRepository({
      repositoryUrl: `file://${sourceRepo}`,
      ref: 'main',
      fetchDepth: 0,
      cwd: fullHistoryCwd,
    });

    await expect(gitOutput(['rev-list', '--count', 'HEAD'], fullHistoryCwd)).resolves.toBe('2');
  });

  it('never persists the credential to .git/config', async () => {
    await checkoutRepository({
      repositoryUrl: `file://${sourceRepo}`,
      ref: 'main',
      cwd,
      auth: {
        kind: 'bearer',
        token: 'super-secret-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'localhost',
        persist: true,
      },
    });

    const gitConfig = await readFile(join(cwd, '.git', 'config'), 'utf8');
    expect(gitConfig).not.toContain('super-secret-token');
    expect(gitConfig.toLowerCase()).not.toContain('extraheader');
  });

  it('never persists a basic credential to .git/config', async () => {
    await checkoutRepository({
      repositoryUrl: `file://${sourceRepo}`,
      ref: 'main',
      cwd,
      auth: {
        kind: 'basic',
        username: 'x-token',
        token: 'super-secret-token',
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'localhost',
        persist: true,
      },
    });

    const gitConfig = await readFile(join(cwd, '.git', 'config'), 'utf8');
    expect(gitConfig).not.toContain('super-secret-token');
    expect(gitConfig).not.toContain(Buffer.from('x-token:super-secret-token').toString('base64'));
    expect(gitConfig.toLowerCase()).not.toContain('extraheader');
  });

  it('fails with a generic CheckoutError for a missing ref', async () => {
    const error = await checkoutRepository({
      repositoryUrl: `file://${sourceRepo}`,
      ref: 'does-not-exist',
      cwd,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CheckoutError);
    expect((error as CheckoutError).kind).toBe('failed');
  });
});

describe('assertGitAvailable (real git)', () => {
  it('resolves when git is on PATH', async () => {
    await expect(assertGitAvailable()).resolves.toMatch(GIT_VERSION_RE);
  });
});

describe('writeAmbientGitCredential (real git)', () => {
  it('scopes the extraHeader to the exact repository URL', async () => {
    const configPath = join(workdir, 'git-cred.config');
    const repositoryUrl = 'https://github.com/acme/repo.git';
    const token = 'super#;secret"token\\tail';

    await writeAmbientGitCredential({
      configPath,
      repositoryUrl,
      auth: {
        kind: 'bearer',
        token,
        expires_at: '2026-01-01T00:00:00Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });

    const exact = await gitOutput(
      ['config', '--file', configPath, '--get-urlmatch', 'http.extraHeader', repositoryUrl],
      workdir,
    );
    await expect(
      execFileAsync('git', [
        'config',
        '--file',
        configPath,
        '--get-urlmatch',
        'http.extraHeader',
        'https://github.com/acme/other.git',
      ]),
    ).rejects.toThrow();

    expect(exact).toBe(`Authorization: Bearer ${token}`);
  });
});
