#!/usr/bin/env node
import {spawn, spawnSync} from 'node:child_process';
import {generateKeyPairSync, randomBytes} from 'node:crypto';
import {closeSync, openSync} from 'node:fs';
import {cp, mkdir, readdir, stat} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultE2eAdminApiKey = 'e2e-admin-api-key';
const defaultApiUrl = 'http://localhost:16101';
const defaultClientUrl = 'http://localhost:5173';
const defaultAuthSignupGateEnabled = 'true';
const defaultAuthSignupAllowedEmailDomains = 'allowed.example.test';
const defaultAuthSignupNotAllowedMessage = 'This E2E deployment does not accept new accounts.';
const defaultReadinessTimeoutMs = 60_000;
const defaultShutdownTimeoutMs = 15_000;
const defaultTurboTask = 'test:e2e';
const trailingSlashPattern = /\/$/;
let generatedGithubAppPrivateKey;
let generatedE2eBootstrapToken;

if (isCliEntryPoint()) {
  main(process.argv.slice(2)).catch((error) => {
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return;
  }

  const env = e2eEnv(process.env);
  const logDir = resolve(options.logDir ?? defaultLogDir(process.env));
  const servers = [];
  let exitCode = 0;
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (signal) printLine(`Received ${signal}; stopping E2E dev servers.`);
    await stopServers(servers);
  }

  process.once('SIGINT', () => {
    shutdown('SIGINT').finally(() => process.exit(130));
  });
  process.once('SIGTERM', () => {
    shutdown('SIGTERM').finally(() => process.exit(143));
  });

  await mkdir(logDir, {recursive: true});

  try {
    servers.push(
      await startServer({
        name: 'api',
        command: 'pnpm',
        args: ['--filter=@shipfox/api', 'dev'],
        env,
        logFile: join(logDir, 'shipfox-api.log'),
      }),
    );
    servers.push(
      await startServer({
        name: 'client',
        command: 'pnpm',
        args: ['--filter=@shipfox/client', 'dev'],
        env,
        logFile: join(logDir, 'shipfox-client.log'),
      }),
    );

    await waitForUrl(`${env.API_URL.replace(trailingSlashPattern, '')}/readyz`, {
      timeoutMs: options.readinessTimeoutMs,
    });
    await waitForUrl(env.CLIENT_URL, {timeoutMs: options.readinessTimeoutMs});

    const result = spawnSync('turbo', turboCommandArgs(options, env), {
      env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    exitCode = result.status ?? 1;
    if (exitCode !== 0) await collectE2eDiagnostics(logDir);
  } catch (error) {
    exitCode = exitCode === 0 ? 1 : exitCode;
    await collectE2eDiagnostics(logDir).catch((diagnosticsError) => {
      printError(
        `Failed to collect E2E diagnostics: ${
          diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError)
        }`,
      );
    });
    throw error;
  } finally {
    if (!options.keepOpen) await shutdown();
  }

  if (exitCode !== 0) process.exit(exitCode);
}

export function parseArgs(argv) {
  const args = [...argv];
  let command = 'run';
  if (args[0] && !args[0].startsWith('-')) command = args.shift();
  if (command !== 'run') {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = {
    help: false,
    keepOpen: false,
    logDir: undefined,
    readinessTimeoutMs: defaultReadinessTimeoutMs,
    turboArgs: [],
    turboTask: defaultTurboTask,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      const passthroughArgs = args.slice(index + 1);
      options.turboArgs.push(
        ...(options.turboArgs.length === 0 ? passthroughArgs : ['--', ...passthroughArgs]),
      );
      break;
    }
    if (applyBooleanOption(arg, options)) continue;
    const valueOptionIndex = applyValueOption(args, index, arg, options);
    if (valueOptionIndex !== null) {
      index = valueOptionIndex;
      continue;
    }
    if (applyInlineOption(arg, options)) continue;

    options.turboArgs.push(arg);
  }

  return options;
}

function applyBooleanOption(arg, options) {
  if (arg === '--help' || arg === '-h') {
    options.help = true;
    return true;
  }
  if (arg === '--keep-open') {
    options.keepOpen = true;
    return true;
  }
  return false;
}

function applyValueOption(args, index, arg, options) {
  if (arg === '--log-dir') {
    options.logDir = requireValue(args, index + 1, arg);
    return index + 1;
  }
  if (arg === '--timeout-ms') {
    options.readinessTimeoutMs = parsePositiveInteger(requireValue(args, index + 1, arg), arg);
    return index + 1;
  }
  if (arg === '--task') {
    options.turboTask = requireValue(args, index + 1, arg);
    return index + 1;
  }
  return null;
}

function applyInlineOption(arg, options) {
  if (arg.startsWith('--log-dir=')) {
    options.logDir = arg.slice('--log-dir='.length);
    return true;
  }
  if (arg.startsWith('--timeout-ms=')) {
    options.readinessTimeoutMs = parsePositiveInteger(
      arg.slice('--timeout-ms='.length),
      '--timeout-ms',
    );
    return true;
  }
  if (arg.startsWith('--task=')) {
    options.turboTask = arg.slice('--task='.length);
    return true;
  }
  return false;
}

function valueOr(value, fallback) {
  if (value !== undefined && value !== null) return value;
  return typeof fallback === 'function' ? fallback() : fallback;
}

export function e2eEnv(sourceEnv) {
  const apiUrl = valueOr(sourceEnv.API_URL, valueOr(sourceEnv.SHIPFOX_API_URL, defaultApiUrl));
  const clientUrl = valueOr(
    sourceEnv.CLIENT_URL,
    valueOr(sourceEnv.CLIENT_BASE_URL, defaultClientUrl),
  );
  const giteaUrl = valueOr(
    sourceEnv.E2E_GITEA_URL,
    valueOr(sourceEnv.GITEA_BASE_URL, 'http://localhost:3000'),
  );
  const linearMcpEndpoint = valueOr(sourceEnv.LINEAR_MCP_ENDPOINT, () =>
    e2eLinearMcpEndpoint(apiUrl),
  );
  const githubApiBaseUrl = valueOr(sourceEnv.GITHUB_API_BASE_URL, () =>
    e2eGithubApiBaseUrl(apiUrl),
  );
  const slackApiBaseUrl = valueOr(sourceEnv.SLACK_API_BASE_URL, () => e2eSlackApiBaseUrl(apiUrl));
  const testVcsPort = valueOr(sourceEnv.INTEGRATIONS_TEST_VCS_PORT, () => e2eTestVcsPort(apiUrl));
  return {
    ...sourceEnv,
    API_URL: apiUrl,
    API_PUBLIC_URL: valueOr(sourceEnv.API_PUBLIC_URL, apiUrl),
    CLIENT_BASE_URL: valueOr(sourceEnv.CLIENT_BASE_URL, clientUrl),
    CLIENT_URL: clientUrl,
    E2E_ADMIN_API_KEY: valueOr(sourceEnv.E2E_ADMIN_API_KEY, defaultE2eAdminApiKey),
    E2E_ENABLED: valueOr(sourceEnv.E2E_ENABLED, 'true'),
    AUTH_ROOT_KEY: valueOr(sourceEnv.AUTH_ROOT_KEY, 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
    // Impersonation ships disabled by default; the E2E deployment opts in so
    // the mint route is live for the suite that exercises it. The admin
    // bootstrap token is generated per run and never defaults to a well-known
    // literal: claiming the first admin owner requires knowing it, so a
    // harness-defaulted deployment is not bootstrap-able by anyone with
    // repository access.
    AUTH_IMPERSONATION_ENABLED: valueOr(sourceEnv.AUTH_IMPERSONATION_ENABLED, 'true'),
    ADMIN_BOOTSTRAP_TOKEN: valueOr(sourceEnv.ADMIN_BOOTSTRAP_TOKEN, e2eBootstrapToken),
    AUTH_SIGNUP_GATE_ENABLED: valueOr(
      sourceEnv.AUTH_SIGNUP_GATE_ENABLED,
      defaultAuthSignupGateEnabled,
    ),
    AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: valueOr(
      sourceEnv.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS,
      defaultAuthSignupAllowedEmailDomains,
    ),
    AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: valueOr(
      sourceEnv.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE,
      defaultAuthSignupNotAllowedMessage,
    ),
    E2E_GITEA_URL: giteaUrl,
    GITEA_CLONE_BASE_URL: valueOr(sourceEnv.GITEA_CLONE_BASE_URL, giteaUrl),
    HOST: valueOr(sourceEnv.HOST, '0.0.0.0'),
    GITHUB_API_BASE_URL: githubApiBaseUrl,
    GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE: valueOr(
      sourceEnv.GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE,
      'enabled',
    ),
    GITHUB_APP_CLIENT_ID: valueOr(sourceEnv.GITHUB_APP_CLIENT_ID, 'e2e-github-client-id'),
    GITHUB_APP_CLIENT_SECRET: valueOr(
      sourceEnv.GITHUB_APP_CLIENT_SECRET,
      'e2e-github-client-secret',
    ),
    GITHUB_APP_ID: valueOr(sourceEnv.GITHUB_APP_ID, '1'),
    GITHUB_APP_PRIVATE_KEY: valueOr(sourceEnv.GITHUB_APP_PRIVATE_KEY, e2eGithubAppPrivateKey),
    GITHUB_APP_SLUG: valueOr(sourceEnv.GITHUB_APP_SLUG, 'shipfox-e2e'),
    GITHUB_APP_USERNAME: valueOr(sourceEnv.GITHUB_APP_USERNAME, 'shipfox-e2e'),
    GITHUB_APP_WEBHOOK_SECRET: valueOr(
      sourceEnv.GITHUB_APP_WEBHOOK_SECRET,
      'e2e-github-webhook-secret',
    ),
    GITHUB_INSTALL_STATE_SECRET: valueOr(
      sourceEnv.GITHUB_INSTALL_STATE_SECRET,
      'e2e-github-install-state-secret',
    ),
    INTEGRATIONS_ENABLE_GITHUB_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_GITHUB_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_LINEAR_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_LINEAR_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_SLACK_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_SLACK_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER,
      'true',
    ),
    INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS: valueOr(
      sourceEnv.INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS,
      '600',
    ),
    INTEGRATIONS_TEST_VCS_PORT: String(testVcsPort),
    LINEAR_MCP_ENDPOINT: linearMcpEndpoint,
    LINEAR_OAUTH_CLIENT_ID: valueOr(sourceEnv.LINEAR_OAUTH_CLIENT_ID, 'e2e-linear-client-id'),
    LINEAR_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.LINEAR_OAUTH_CLIENT_SECRET,
      'e2e-linear-client-secret',
    ),
    LINEAR_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.LINEAR_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/linear/callback`,
    ),
    LINEAR_WEBHOOK_SIGNING_SECRET: valueOr(
      sourceEnv.LINEAR_WEBHOOK_SIGNING_SECRET,
      'e2e-linear-webhook-secret',
    ),
    SLACK_API_BASE_URL: slackApiBaseUrl,
    SLACK_OAUTH_CLIENT_ID: valueOr(sourceEnv.SLACK_OAUTH_CLIENT_ID, 'e2e-slack-client-id'),
    SLACK_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.SLACK_OAUTH_CLIENT_SECRET,
      'e2e-slack-client-secret',
    ),
    SLACK_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.SLACK_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/slack/callback`,
    ),
    SLACK_SIGNING_SECRET: valueOr(sourceEnv.SLACK_SIGNING_SECRET, 'e2e-slack-signing-secret'),
    VITE_API_URL: valueOr(sourceEnv.VITE_API_URL, apiUrl),
    VITE_ENABLE_TEST_VCS_PROVIDER: valueOr(sourceEnv.VITE_ENABLE_TEST_VCS_PROVIDER, 'true'),
    WEBHOOK_PUBLIC_URL: valueOr(sourceEnv.WEBHOOK_PUBLIC_URL, apiUrl),
  };
}

export function e2eGithubApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const githubApiPort = apiPort + 10;
  if (githubApiPort > 65_535) {
    throw new Error(`Cannot derive a GitHub API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(githubApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2eTestVcsPort(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  // Worktree services reserve the API block through the temporal metrics port
  // at API + 12. Keep the fixture in the unused tail of that block.
  const testVcsPort = apiPort + 14;
  if (testVcsPort > 65_535) {
    throw new Error(`Cannot derive a test VCS port from API port ${apiPort}.`);
  }
  return testVcsPort;
}

export function e2eSlackApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const slackApiPort = apiPort + 11;
  if (slackApiPort > 65_535) {
    throw new Error(`Cannot derive a Slack API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(slackApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

function e2eGithubAppPrivateKey() {
  generatedGithubAppPrivateKey ??= generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
    publicKeyEncoding: {format: 'pem', type: 'spki'},
  }).privateKey;
  return generatedGithubAppPrivateKey;
}

function e2eBootstrapToken() {
  generatedE2eBootstrapToken ??= randomBytes(32).toString('base64url');
  return generatedE2eBootstrapToken;
}

export function e2eLinearMcpEndpoint(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const linearMcpPort = apiPort + 9;
  if (linearMcpPort > 65_535) {
    throw new Error(`Cannot derive a Linear MCP port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(linearMcpPort);
  endpoint.pathname = '/mcp';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function turboCommandArgs(options, env) {
  const args = [options.turboTask, ...options.turboArgs];
  if (hasTurboConcurrency(args)) return args;

  const concurrency = env.SHIPFOX_TURBO_CONCURRENCY;
  if (!concurrency) return args;

  const separatorIndex = args.indexOf('--');
  if (separatorIndex < 0) return [...args, `--concurrency=${concurrency}`];
  return [
    ...args.slice(0, separatorIndex),
    `--concurrency=${concurrency}`,
    ...args.slice(separatorIndex),
  ];
}

function hasTurboConcurrency(args) {
  const separatorIndex = args.indexOf('--');
  const turboArgs = separatorIndex < 0 ? args : args.slice(0, separatorIndex);
  return turboArgs.some((arg) => arg === '--concurrency' || arg.startsWith('--concurrency='));
}

export function defaultLogDir(env) {
  return join(env.RUNNER_TEMP ?? '.context', 'shipfox-e2e-logs');
}

async function startServer(params) {
  await mkdir(dirname(params.logFile), {recursive: true});
  const logFd = openSync(params.logFile, 'a');
  let child;
  try {
    child = spawn(params.command, params.args, {
      detached: process.platform !== 'win32',
      env: params.env,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }

  if (child.pid === undefined) throw new Error(`Failed to start ${params.name}`);
  return {name: params.name, child, logFile: params.logFile};
}

async function stopServers(servers) {
  await Promise.allSettled(servers.map((server) => stopServer(server)));
}

function stopServer(server) {
  const {child} = server;
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  const exited = new Promise((resolve) => child.once('exit', resolve));
  killChild(child, 'SIGTERM');

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      killChild(child, 'SIGKILL');
      exited.then(resolve);
    }, defaultShutdownTimeoutMs);
    exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function killChild(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // Already exited.
  }
}

export async function waitForUrl(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? defaultReadinessTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }

  throw new Error(
    `Timed out waiting for ${url}${lastError instanceof Error ? ` (${lastError.message})` : ''}`,
  );
}

export async function collectE2eDiagnostics(logDir) {
  const diagnosticsDir = join(logDir, 'docker');
  await mkdir(diagnosticsDir, {recursive: true});

  await Promise.all([
    writeCommandOutput('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], {
      file: join(diagnosticsDir, 'containers.jsonl'),
    }),
    writeCommandOutput('docker', ['images', '--digests'], {
      file: join(diagnosticsDir, 'images.txt'),
    }),
    writeCommandOutput('docker', ['network', 'ls'], {
      file: join(diagnosticsDir, 'networks.txt'),
    }),
    writeCommandOutput('docker', ['network', 'inspect', 'bridge'], {
      file: join(diagnosticsDir, 'network-bridge.json'),
    }),
    copySharedOllamaLog(logDir),
  ]);

  const runnerLogs = 'e2e/suites/flow/workflows/.e2e-run/runners';
  try {
    await cp(runnerLogs, join(logDir, 'flow-workflow-runners'), {
      recursive: true,
      force: true,
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await copyPlaywrightTestResults(logDir);
}

export async function copySharedOllamaLog(logDir, env = process.env, cwd = process.cwd()) {
  const rootPath = resolve(env.CONDUCTOR_ROOT_PATH || cwd);
  const source = join(rootPath, '.context/shared-ollama/ollama.log');
  const target = join(logDir, 'shared-ollama/ollama.log');

  try {
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target, {force: true});
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function copyPlaywrightTestResults(logDir) {
  const suiteLevelDirs = ['e2e/suites/api', 'e2e/suites/client', 'e2e/suites/flow'];

  for (const suiteLevelDir of suiteLevelDirs) {
    let entries;
    try {
      entries = await readdir(suiteLevelDir, {withFileTypes: true});
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const source = join(suiteLevelDir, entry.name, 'test-results');
      if (!(await isDirectory(source))) continue;

      await cp(source, join(logDir, 'playwright-test-results', source), {
        recursive: true,
        force: true,
      });
    }
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeCommandOutput(command, args, options) {
  await mkdir(dirname(options.file), {recursive: true});
  const outputFd = openSync(options.file, 'w');
  try {
    const result = spawnSync(command, args, {stdio: ['ignore', outputFd, outputFd]});
    if (result.error) {
      // Best-effort diagnostics: write the error only if the command could not start.
      printError(`${command} ${args.join(' ')} failed: ${result.error.message}`);
    }
  } finally {
    closeSync(outputFd);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function usage() {
  printLine(`Usage: mise run e2e [options] [turbo args]

Options:
  --filter=<package>      Passed through to turbo, for example --filter=@shipfox/e2e-flow-workflows
  --keep-open             Leave API and client dev servers running after tests
  --log-dir=<path>        Directory for API/client logs and failure diagnostics
  --task=<task>           Turbo task to run (default: test:e2e)
  --timeout-ms=<ms>       Readiness timeout for API and client (default: 60000)

Examples:
  mise run e2e -- --filter=@shipfox/e2e-flow-workflows
  mise run e2e -- --filter=@shipfox/e2e-client-auth
`);
}

function isCliEntryPoint() {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

function printLine(message) {
  process.stdout.write(`${message}\n`);
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}
