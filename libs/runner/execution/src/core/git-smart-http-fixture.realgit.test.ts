import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {createGitSmartHttpFixture} from '#test/git-smart-http-fixture.js';

const execFileAsync = promisify(execFile);
const USERNAME = 'x-access-token';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';

async function git(args: string[], cwd: string, token: string): Promise<string> {
  const {stdout} = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${USERNAME}:${token}`).toString('base64')}`,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return stdout;
}

async function gitWithoutAuth(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, {cwd});
}

describe('Git smart-HTTP fixture (real git)', () => {
  let workdir: string;
  let bareRepository: string;
  let seedRepository: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'shipfox-git-http-fixture-'));
    bareRepository = join(workdir, 'repo.git');
    seedRepository = join(workdir, 'seed');
    await mkdir(seedRepository, {recursive: true});
    await gitWithoutAuth(['init', '--bare', bareRepository], workdir);
    await gitWithoutAuth(['config', 'http.receivepack', 'true'], bareRepository);
    await gitWithoutAuth(['init', '-b', 'main', seedRepository], seedRepository);
    await gitWithoutAuth(['config', 'user.email', 'test@shipfox.io'], seedRepository);
    await gitWithoutAuth(['config', 'user.name', 'Test'], seedRepository);
    await writeFile(join(seedRepository, 'README.md'), '# fixture\n');
    await gitWithoutAuth(['add', '.'], seedRepository);
    await gitWithoutAuth(['commit', '-m', 'initial'], seedRepository);
    await gitWithoutAuth(['push', bareRepository, 'main'], seedRepository);
  });

  afterEach(async () => {
    await rm(workdir, {recursive: true, force: true});
  });

  it('challenges rejected credentials, records auth, and accepts a later generation for fetch and push', async () => {
    const fixture = createGitSmartHttpFixture({
      repositoryPath: bareRepository,
      credentials: [
        {generation: 1, username: USERNAME, token: TOKEN_A, accepted: false},
        {generation: 2, username: USERNAME, token: TOKEN_B, accepted: true},
      ],
    });
    await fixture.start();
    fixture.setGeneration(1);

    try {
      const rejected = await fetch(fixture.url, {
        headers: {
          authorization: `Basic ${Buffer.from(`${USERNAME}:${TOKEN_A}`).toString('base64')}`,
        },
      });
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get('www-authenticate')).toBe('Basic realm="shipfox-test-git"');

      await expect(git(['ls-remote', fixture.url], workdir, TOKEN_A)).rejects.toThrow();
      fixture.setGeneration(2);
      expect(fixture.authorizationHeaders).toContain(
        `Basic ${Buffer.from(`${USERNAME}:${TOKEN_A}`).toString('base64')}`,
      );
      expect(fixture.requests).toContainEqual({
        method: 'GET',
        path: '/repo.git/info/refs?service=git-upload-pack',
        authorization: `Basic ${Buffer.from(`${USERNAME}:${TOKEN_A}`).toString('base64')}`,
      });

      const clone = join(workdir, 'clone');
      await git(['clone', '--branch', 'main', fixture.url, clone], workdir, TOKEN_B);
      expect(
        await git(['-C', clone, 'rev-parse', '--is-inside-work-tree'], workdir, TOKEN_B),
      ).toContain('true');
      await git(['-C', clone, 'fetch', 'origin', 'main'], workdir, TOKEN_B);

      await writeFile(join(clone, 'README.md'), '# updated by fixture test\n');
      await gitWithoutAuth(['-C', clone, 'config', 'user.email', 'test@shipfox.io'], workdir);
      await gitWithoutAuth(['-C', clone, 'config', 'user.name', 'Test'], workdir);
      await gitWithoutAuth(['-C', clone, 'add', '.'], workdir);
      await gitWithoutAuth(['-C', clone, 'commit', '-m', 'update'], workdir);
      await git(['-C', clone, 'push', 'origin', 'main'], workdir, TOKEN_B);

      expect(fixture.requestCount).toBeGreaterThan(3);
      expect(
        fixture.authorizationHeaders.filter((header) => header?.includes(TOKEN_A)),
      ).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });

  it('does not print or expose credentials through fixture lifecycle output', async () => {
    const fixture = createGitSmartHttpFixture({
      repositoryPath: bareRepository,
      credentials: [{generation: 'fresh', username: USERNAME, token: TOKEN_B, accepted: true}],
    });
    const log = vi.spyOn(console, 'log');

    await fixture.start();
    await git(['ls-remote', fixture.url], workdir, TOKEN_B);
    await fixture.close();

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
