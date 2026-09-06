import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {
  copyPlaywrightTestResults,
  copySharedOllamaLog,
  defaultLogDir,
  e2eTestVcsPort,
  e2eEnv,
  parseArgs,
  turboCommandArgs,
} from '../src/e2e.mjs';

const unknownCommandPattern = /Unknown command/;

describe('parseArgs', () => {
  test('defaults to running all E2E tests', () => {
    const options = parseArgs([]);

    assert.equal(options.turboTask, 'test:e2e');
    assert.deepEqual(options.turboArgs, []);
    assert.equal(options.keepOpen, false);
  });

  test('passes turbo filter arguments through', () => {
    const options = parseArgs(['run', '--filter=@shipfox/e2e-flow-workflows']);

    assert.deepEqual(options.turboArgs, ['--filter=@shipfox/e2e-flow-workflows']);
  });

  test('parses harness options before turbo args', () => {
    const options = parseArgs([
      'run',
      '--keep-open',
      '--log-dir=.context/e2e',
      '--timeout-ms',
      '120000',
      '--',
      '--filter=@shipfox/e2e-client-auth',
    ]);

    assert.equal(options.keepOpen, true);
    assert.equal(options.logDir, '.context/e2e');
    assert.equal(options.readinessTimeoutMs, 120_000);
    assert.deepEqual(options.turboArgs, ['--filter=@shipfox/e2e-client-auth']);
  });

  test('preserves a turbo task separator for nested test arguments', () => {
    const options = parseArgs([
      'run',
      '--filter=@shipfox/e2e-flow-workflows',
      '--',
      '--grep=renewable credentials',
    ]);

    assert.deepEqual(options.turboArgs, [
      '--filter=@shipfox/e2e-flow-workflows',
      '--',
      '--grep=renewable credentials',
    ]);
  });

  test('rejects unknown commands', () => {
    assert.throws(() => parseArgs(['down']), unknownCommandPattern);
  });
});

describe('e2eEnv', () => {
  test('uses worktree local-service URLs when present', () => {
    const env = e2eEnv({
      SHIPFOX_API_URL: 'http://localhost:55351',
      CLIENT_BASE_URL: 'http://localhost:55350',
      GITEA_BASE_URL: 'http://localhost:55356',
    });

    assert.equal(env.API_URL, 'http://localhost:55351');
    assert.equal(env.API_PUBLIC_URL, 'http://localhost:55351');
    assert.equal(env.CLIENT_BASE_URL, 'http://localhost:55350');
    assert.equal(env.CLIENT_URL, 'http://localhost:55350');
    assert.equal(env.E2E_GITEA_URL, 'http://localhost:55356');
    assert.equal(env.GITEA_CLONE_BASE_URL, 'http://localhost:55356');
    assert.equal(env.INTEGRATIONS_ENABLE_LINEAR_PROVIDER, 'true');
    assert.equal(env.INTEGRATIONS_ENABLE_GITHUB_PROVIDER, 'true');
    assert.equal(env.INTEGRATIONS_ENABLE_SLACK_PROVIDER, 'true');
    assert.equal(env.INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER, 'true');
    assert.equal(env.INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS, '600');
    assert.equal(env.INTEGRATIONS_TEST_VCS_PORT, '55365');
    assert.equal(env.AUTH_ROOT_KEY, 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=');
    assert.equal(env.AUTH_SIGNUP_GATE_ENABLED, 'true');
    assert.equal(env.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS, 'allowed.example.test');
    assert.equal(
      env.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE,
      'This E2E deployment does not accept new accounts.',
    );
    assert.equal(env.GITHUB_API_BASE_URL, 'http://127.0.0.1:55361/');
    assert.equal(env.GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE, 'enabled');
    assert.equal(env.SLACK_API_BASE_URL, 'http://127.0.0.1:55362/');
    assert.match(env.GITHUB_APP_PRIVATE_KEY, /BEGIN PRIVATE KEY/u);
    assert.equal(env.LINEAR_MCP_ENDPOINT, 'http://127.0.0.1:55360/mcp');
    assert.equal(env.LINEAR_OAUTH_CLIENT_ID, 'e2e-linear-client-id');
    assert.equal(env.SHIPFOX_TURBO_CONCURRENCY, undefined);
    assert.equal(env.VITE_API_URL, 'http://localhost:55351');
    assert.equal(env.WEBHOOK_PUBLIC_URL, 'http://localhost:55351');
  });

  test('keeps explicit CI URLs over local-service defaults', () => {
    const env = e2eEnv({
      API_URL: 'http://localhost:16101',
      API_PUBLIC_URL: 'https://api.example.test',
      CLIENT_URL: 'http://localhost:5173',
      E2E_GITEA_URL: 'http://localhost:3001',
      GITEA_CLONE_BASE_URL: 'http://localhost:3000',
      LINEAR_MCP_ENDPOINT: 'http://127.0.0.1:16120/mcp',
      GITHUB_API_BASE_URL: 'http://127.0.0.1:16121',
      GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE: 'disabled',
      SLACK_API_BASE_URL: 'http://127.0.0.1:16122',
      SHIPFOX_API_URL: 'http://localhost:55351',
      GITEA_BASE_URL: 'http://localhost:55356',
      WEBHOOK_PUBLIC_URL: 'https://webhooks.example.test',
      AUTH_SIGNUP_GATE_ENABLED: 'false',
      AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: 'override.example.test',
      AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: 'Signups are temporarily closed.',
    });

    assert.equal(env.API_URL, 'http://localhost:16101');
    assert.equal(env.API_PUBLIC_URL, 'https://api.example.test');
    assert.equal(env.CLIENT_URL, 'http://localhost:5173');
    assert.equal(env.E2E_GITEA_URL, 'http://localhost:3001');
    assert.equal(env.GITEA_CLONE_BASE_URL, 'http://localhost:3000');
    assert.equal(env.LINEAR_MCP_ENDPOINT, 'http://127.0.0.1:16120/mcp');
    assert.equal(env.GITHUB_API_BASE_URL, 'http://127.0.0.1:16121');
    assert.equal(env.GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE, 'disabled');
    assert.equal(env.SLACK_API_BASE_URL, 'http://127.0.0.1:16122');
    assert.equal(env.INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS, '600');
    assert.equal(env.INTEGRATIONS_TEST_VCS_PORT, '16115');
    assert.equal(env.WEBHOOK_PUBLIC_URL, 'https://webhooks.example.test');
    assert.equal(env.AUTH_SIGNUP_GATE_ENABLED, 'false');
    assert.equal(env.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS, 'override.example.test');
    assert.equal(env.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE, 'Signups are temporarily closed.');
  });

  test('keeps explicit turbo concurrency', () => {
    const env = e2eEnv({
      SHIPFOX_TURBO_CONCURRENCY: '3',
    });

    assert.equal(env.SHIPFOX_TURBO_CONCURRENCY, '3');
  });

  test('rejects an API port that cannot reserve the Linear MCP offset', () => {
    assert.throws(
      () => e2eEnv({API_URL: 'http://localhost:65527'}),
      /Cannot derive a Linear MCP port/u,
    );
  });

  test('rejects an API port that cannot reserve the GitHub API offset', () => {
    assert.throws(
      () => e2eEnv({API_URL: 'http://localhost:65526'}),
      /Cannot derive a GitHub API port/u,
    );
  });

  test('rejects an API port that cannot reserve the Slack API offset', () => {
    assert.throws(
      () => e2eEnv({API_URL: 'http://localhost:65525'}),
      /Cannot derive a Slack API port/u,
    );
  });

  test('rejects an API port that cannot reserve the Test VCS offset', () => {
    assert.throws(
      () => e2eEnv({API_URL: 'http://localhost:65522'}),
      /Cannot derive a test VCS port/u,
    );
  });
});

describe('e2eTestVcsPort', () => {
  test('reserves the Test VCS port after the API port', () => {
    assert.equal(e2eTestVcsPort('http://localhost:16101'), 16115);
  });
});

describe('turboCommandArgs', () => {
  test('uses E2E turbo concurrency from the environment', () => {
    const args = turboCommandArgs(
      {
        turboArgs: ['--filter=@shipfox/e2e-client-agent'],
        turboTask: 'test:e2e',
      },
      {SHIPFOX_TURBO_CONCURRENCY: '2'},
    );

    assert.deepEqual(args, [
      'test:e2e',
      '--filter=@shipfox/e2e-client-agent',
      '--concurrency=2',
    ]);
  });

  test('keeps turbo default concurrency without an environment override', () => {
    const args = turboCommandArgs(
      {
        turboArgs: ['--filter=@shipfox/e2e-client-agent'],
        turboTask: 'test:e2e',
      },
      {},
    );

    assert.deepEqual(args, ['test:e2e', '--filter=@shipfox/e2e-client-agent']);
  });

  test('does not override explicit turbo concurrency', () => {
    const args = turboCommandArgs(
      {
        turboArgs: ['--concurrency=4'],
        turboTask: 'test:e2e',
      },
      {SHIPFOX_TURBO_CONCURRENCY: '2'},
    );

    assert.deepEqual(args, ['test:e2e', '--concurrency=4']);
  });

  test('supports turbo concurrency passed as a separate value', () => {
    const args = turboCommandArgs(
      {
        turboArgs: ['--concurrency', '4'],
        turboTask: 'test:e2e',
      },
      {SHIPFOX_TURBO_CONCURRENCY: '2'},
    );

    assert.deepEqual(args, ['test:e2e', '--concurrency', '4']);
  });

  test('places the environment concurrency before test-runner arguments', () => {
    const args = turboCommandArgs(
      {
        turboArgs: ['--filter=@shipfox/e2e-client-agent', '--', '--grep=renewable'],
        turboTask: 'test:e2e',
      },
      {SHIPFOX_TURBO_CONCURRENCY: '2'},
    );

    assert.deepEqual(args, [
      'test:e2e',
      '--filter=@shipfox/e2e-client-agent',
      '--concurrency=2',
      '--',
      '--grep=renewable',
    ]);
  });
});

describe('defaultLogDir', () => {
  test('uses GitHub runner temp when available', () => {
    assert.equal(defaultLogDir({RUNNER_TEMP: '/tmp/gha'}), '/tmp/gha/shipfox-e2e-logs');
  });

  test('falls back to .context locally', () => {
    assert.equal(defaultLogDir({}), '.context/shipfox-e2e-logs');
  });
});

describe('copySharedOllamaLog', () => {
  test('stages the shared Ollama service log when present', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'shipfox-e2e-workspace-'));
    const rootDir = join(workspaceDir, 'root');
    const logDir = join(workspaceDir, 'logs');
    try {
      await mkdir(join(rootDir, '.context/shared-ollama'), {recursive: true});
      await writeFile(join(rootDir, '.context/shared-ollama/ollama.log'), 'ollama warmup log');

      await copySharedOllamaLog(logDir, {CONDUCTOR_ROOT_PATH: rootDir}, workspaceDir);

      assert.equal(
        await readFile(join(logDir, 'shared-ollama/ollama.log'), 'utf8'),
        'ollama warmup log',
      );
    } finally {
      await rm(workspaceDir, {recursive: true, force: true});
    }
  });
});

describe('copyPlaywrightTestResults', () => {
  test('stages only Playwright package test results', async () => {
    const originalCwd = process.cwd();
    const workspaceDir = await mkdtemp(join(tmpdir(), 'shipfox-e2e-workspace-'));
    const logDir = join(workspaceDir, 'logs');
    try {
      process.chdir(workspaceDir);
      await mkdir('e2e/suites/api/auth/test-results/auth-flow', {recursive: true});
      await mkdir('e2e/suites/client/workspaces/test-results/workspace-flow', {recursive: true});
      await mkdir('e2e/suites/flow/workflows/test-results/scenario', {recursive: true});
      await mkdir('e2e/setup/auth/test-results/helper-flow', {recursive: true});
      await writeFile('e2e/suites/api/auth/test-results/auth-flow/trace.zip', 'api trace');
      await writeFile(
        'e2e/suites/client/workspaces/test-results/workspace-flow/trace.zip',
        'client trace',
      );
      await writeFile('e2e/suites/flow/workflows/test-results/scenario/trace.zip', 'flow trace');
      await writeFile('e2e/setup/auth/test-results/helper-flow/trace.zip', 'helper trace');

      await copyPlaywrightTestResults(logDir);

      assert.equal(
        await readFile(
          join(logDir, 'playwright-test-results/e2e/suites/api/auth/test-results/auth-flow/trace.zip'),
          'utf8',
        ),
        'api trace',
      );
      assert.equal(
        await readFile(
          join(
            logDir,
            'playwright-test-results/e2e/suites/client/workspaces/test-results/workspace-flow/trace.zip',
          ),
          'utf8',
        ),
        'client trace',
      );
      assert.equal(
        await readFile(
          join(
            logDir,
            'playwright-test-results/e2e/suites/flow/workflows/test-results/scenario/trace.zip',
          ),
          'utf8',
        ),
        'flow trace',
      );
      await assert.rejects(
        readFile(
          join(
            logDir,
            'playwright-test-results/e2e/setup/auth/test-results/helper-flow/trace.zip',
          ),
          'utf8',
        ),
        {code: 'ENOENT'},
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspaceDir, {recursive: true, force: true});
    }
  });
});
