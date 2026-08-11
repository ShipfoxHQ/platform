import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {CheckoutTokenAuthDto, StepDto} from '@shipfox/api-workflows-dto';
import {writeAmbientGitCredential} from '@shipfox/runner-workspace';
import {executeRunStep} from '#core/run-step.js';

// Exercises the persisted-checkout contract for shell steps against real git: the ambient
// config a persisted checkout writes must reach `git` in the step, so a workflow can commit
// and push without authoring its own identity or credential. A mocked spawn would accept an
// environment entry git never reads.
const execFileAsync = promisify(execFile);
const REPOSITORY_URL = 'https://github.com/acme/repo.git';
const GIT_AUTHOR = {
  name: 'shipfox-ai[bot]',
  email: '12345+shipfox-ai[bot]@users.noreply.github.com',
};
const AUTH: CheckoutTokenAuthDto = {
  kind: 'basic',
  username: 'x-access-token',
  token: 'ghs-persisted-token',
  expires_at: '2026-01-01T00:00:00.000Z',
  carry: 'header',
  host: 'github.com',
  persist: true,
};
const EXPECTED_HEADER = `Authorization: Basic ${Buffer.from(`${AUTH.username}:${AUTH.token}`).toString('base64')}`;

let workdir: string;
let repository: string;
let gitConfigPath: string;
let capturePath: string;

async function git(args: string[], dir: string): Promise<void> {
  await execFileAsync('git', args, {cwd: dir});
}

function readCapture(): Promise<string> {
  return readFile(capturePath, 'utf8');
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'shipfox-run-step-git-'));
  repository = join(workdir, 'repo');
  gitConfigPath = join(workdir, 'cred', 'git-cred.config');
  capturePath = join(workdir, 'capture.txt');
  await mkdir(repository, {recursive: true});
  await git(['init', '-b', 'main'], repository);
  // The ambient config includes the host's global config, so a host commit.gpgsign=true
  // would fail the commit for a signing key this throwaway repository does not have.
  await git(['config', 'commit.gpgsign', 'false'], repository);
  await writeFile(join(repository, 'README.md'), '# hello\n');

  await writeAmbientGitCredential({
    configPath: gitConfigPath,
    repositoryUrl: REPOSITORY_URL,
    auth: AUTH,
    gitAuthor: GIT_AUTHOR,
  });
});

afterEach(async () => {
  await rm(workdir, {recursive: true, force: true});
});

describe('executeRunStep with a persisted checkout config (real git)', () => {
  it('commits with the checkout author identity without workflow-authored git config', async () => {
    const step = buildRunStep(
      [
        'git add README.md',
        'git commit -m "Reproduce checkout configuration"',
        `git log -1 --pretty="%an <%ae>" > "${capturePath}"`,
      ].join('\n'),
    );

    const result = await executeRunStep(step, {cwd: repository, gitConfigGlobal: gitConfigPath});

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect((await readCapture()).trim()).toBe(`${GIT_AUTHOR.name} <${GIT_AUTHOR.email}>`);
  });

  it('exposes the repository-scoped authentication header to git in the step', async () => {
    const step = buildRunStep(
      `git config --get-urlmatch http.extraHeader ${REPOSITORY_URL} > "${capturePath}"`,
    );

    const result = await executeRunStep(step, {cwd: repository, gitConfigGlobal: gitConfigPath});

    expect(result.success).toBe(true);
    expect((await readCapture()).trim()).toBe(EXPECTED_HEADER);
  });

  it('keeps the credential out of the repository config', async () => {
    const step = buildRunStep(
      ['git add README.md', 'git commit -m "Commit with ambient credentials"'].join('\n'),
    );

    const result = await executeRunStep(step, {cwd: repository, gitConfigGlobal: gitConfigPath});

    expect(result.success).toBe(true);
    const repositoryConfig = await readFile(join(repository, '.git', 'config'), 'utf8');
    expect(repositoryConfig).not.toContain(AUTH.token);
    expect(repositoryConfig).not.toContain('extraHeader');
  });

  it('leaves git without the checkout identity when credentials were not persisted', async () => {
    const step = buildRunStep(
      `git config --get user.email > "${capturePath}" || echo "unset" > "${capturePath}"`,
    );

    const result = await executeRunStep(step, {cwd: repository});

    expect(result.success).toBe(true);
    expect((await readCapture()).trim()).not.toBe(GIT_AUTHOR.email);
  });
});

function buildRunStep(run: string): StepDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    key: 'test-step',
    name: 'test-step',
    source_location: null,
    status: 'running',
    status_reason: null,
    type: 'run',
    config: {run},
    error: null,
    evaluation_trace: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}
