import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {CheckoutCredentials} from '@shipfox/api-integration-spi';
import {createTestVcsFixture} from '#providers/test-vcs-fixture.js';

const execFileAsync = promisify(execFile);

async function git(
  args: string[],
  cwd: string,
  repositoryUrl: string,
  credentials: CheckoutCredentials,
): Promise<string> {
  const authorization = Buffer.from(`${credentials.username}:${credentials.token}`).toString(
    'base64',
  );
  const result = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: `http.${repositoryUrl}.extraHeader`,
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${authorization}`,
      GIT_CONFIG_KEY_1: 'http.sslVerify',
      GIT_CONFIG_VALUE_1: 'false',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return result.stdout;
}

function credentials(
  fixture: ReturnType<typeof createTestVcsFixture>,
  repository: {owner: string; name: string},
  generation = 'generation-a',
): CheckoutCredentials {
  return fixture.issueCredential({
    ...repository,
    permissions: {contents: 'write'},
    renewalMode: 'on-rejection',
    ttlSeconds: 1,
    rejectedGeneration: generation === 'generation-a' ? undefined : 'generation-a',
  });
}

describe('Test VCS smart HTTP fixture', () => {
  it('requires a credential and accepts a fresh credential after expiry', async () => {
    const fixture = createTestVcsFixture({port: 0});
    const workingDirectory = await mkdtemp(join(tmpdir(), 'shipfox-test-vcs-git-'));
    try {
      await fixture.start();
      const repository = await fixture.createRepository({
        owner: 'e2e-owner',
        name: 'repository',
        files: [{path: 'README.md', content: '# Test VCS\n'}],
      });
      const first = credentials(fixture, {owner: 'e2e-owner', name: 'repository'});

      await expect(
        git(
          ['ls-remote', repository.cloneUrl, 'refs/heads/main'],
          workingDirectory,
          repository.cloneUrl,
          first,
        ),
      ).resolves.toContain('refs/heads/main');
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await expect(
        git(
          ['ls-remote', repository.cloneUrl, 'refs/heads/main'],
          workingDirectory,
          repository.cloneUrl,
          first,
        ),
      ).rejects.toThrow();

      const second = credentials(fixture, {owner: 'e2e-owner', name: 'repository'}, 'generation-b');
      await expect(
        git(
          ['ls-remote', repository.cloneUrl, 'refs/heads/main'],
          workingDirectory,
          repository.cloneUrl,
          second,
        ),
      ).resolves.toContain('refs/heads/main');

      const stats = fixture.stats('e2e-owner');
      expect(stats.rejectedRequestCount).toBeGreaterThan(0);
      expect(stats.acceptedRequestCount).toBeGreaterThan(0);
      expect(stats.generations).toContain(first.generation);
      expect(stats.generations).toContain(second.generation);
      expect(stats.requests.every((request) => !request.path.includes(first.token))).toBe(true);
    } finally {
      await fixture.close();
      await rm(workingDirectory, {recursive: true, force: true});
    }
  });

  it('rejects Git-invalid default branch names before creating a repository', async () => {
    const fixture = createTestVcsFixture({port: 0});
    try {
      await fixture.start();

      await expect(
        fixture.createRepository({
          owner: 'e2e-owner',
          name: 'invalid-branch',
          defaultBranch: 'feature.lock',
          files: [{path: 'README.md', content: '# Test VCS\n'}],
        }),
      ).rejects.toThrow('Invalid test VCS branch name');
      expect(fixture.getRepository('e2e-owner', 'invalid-branch')).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });
});
