import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  type CloudflarePagesApp,
  type CloudflarePagesEnvironment,
  defaultCloudflarePagesEnvironments,
} from './plan.js';

const pagesDevUrlPattern = /https:\/\/[A-Za-z0-9.-]+\.pages\.dev\/?/g;
const trailingSlashPattern = /\/$/;

export type CommandOptions = {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  input?: string | undefined;
  stream?: boolean | undefined;
  timeoutMs?: number | undefined;
};

export type CommandResult = {
  code: number | null;
  output: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Run Wrangler while preserving its output for CI logs.
 */
export function runCommand(
  command: string,
  args: string[],
  {
    cwd = process.cwd(),
    env = process.env,
    input,
    stream = true,
    timeoutMs = 300_000,
  }: CommandOptions = {},
): Promise<CommandResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('timeoutMs must be a positive number'));
  }
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let errorOutput = '';
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let hardKillTimeout: NodeJS.Timeout | undefined;
    let closeGraceTimeout: NodeJS.Timeout | undefined;
    const terminate = (signal: NodeJS.Signals): void => {
      try {
        child.kill(signal);
      } catch {
        // The process may have exited between the timeout and the signal.
      }
    };
    const clearTimers = (): void => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (hardKillTimeout !== undefined) clearTimeout(hardKillTimeout);
      if (closeGraceTimeout !== undefined) clearTimeout(closeGraceTimeout);
    };
    const destroyStreams = (): void => {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (error !== undefined) {
        reject(error);
      } else {
        resolve({code: 0, output, stderr: errorOutput});
      }
    };
    const timeoutError = (): Error => new Error(`${command} timed out after ${timeoutMs}ms`);
    const finishExit = (code: number | null): void => {
      if (timedOut) {
        finish(timeoutError());
        return;
      }
      if (code === 0) {
        finish();
        return;
      }

      finish(
        new Error(`${command} exited with code ${code}: ${`${output}\n${errorOutput}`.trim()}`),
      );
    };
    timeout = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      hardKillTimeout = setTimeout(() => {
        terminate('SIGKILL');
        destroyStreams();
        finish(timeoutError());
      }, 5_000);
      hardKillTimeout.unref();
    }, timeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      if (stream) process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      errorOutput += text;
      if (stream) process.stderr.write(text);
    });
    child.on('error', (error) => {
      finish(error);
    });
    child.stdin.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'EPIPE') return;
      finish(error);
    });
    child.on('exit', (code) => {
      if (!timedOut && timeout !== undefined) clearTimeout(timeout);
      // A grandchild can inherit stdout/stderr and keep the `close` event open
      // after the command itself has exited. Give output a short drain window,
      // then destroy the pipes and settle from the command's exit status.
      closeGraceTimeout = setTimeout(() => {
        destroyStreams();
        finishExit(code);
      }, 1_000);
      closeGraceTimeout.unref();
    });
    child.on('close', (code) => {
      finishExit(code);
    });

    try {
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function readWranglerDeploymentOutput(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const entries: Array<Record<string, unknown>> = (await readFile(path, 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return (
      entries.find((entry) => entry.type === 'pages-deploy-detailed') ??
      entries.find((entry) => entry.type === 'pages-deploy')
    );
  } catch {
    return undefined;
  }
}

function getCloudflareDeploymentUrl(
  output: string,
  structuredOutput?: Record<string, unknown>,
): string | null {
  if (typeof structuredOutput?.url === 'string' && structuredOutput.url.length > 0) {
    return structuredOutput.url.replace(trailingSlashPattern, '');
  }

  // Keep a compatibility fallback for Wrangler versions without structured
  // output. The immutable deployment URL is printed before the branch alias.
  const match = output.match(pagesDevUrlPattern);
  return match?.[0]?.replace(trailingSlashPattern, '') ?? null;
}

/**
 * Upload a static directory to Cloudflare Pages through Direct Upload.
 */
type DeployCloudflarePagesOptions = {
  directory?: string | undefined;
  project?: string | undefined;
  branch?: string | null | undefined;
  environment?: string | undefined;
  commitSha?: string | undefined;
  command?: string | undefined;
  attempts?: number | undefined;
  retryDelayMs?: number | undefined;
  cwd?: string | undefined;
  runner?: CommandRunner | undefined;
  timeoutMs?: number | undefined;
};

export type CloudflarePagesSingleDeployment = {
  url: string;
  directory: string;
  project: string;
  branch: string | null;
  commitSha: string;
  attempts: number;
};

export async function deployCloudflarePages({
  directory,
  project,
  branch = null,
  environment,
  commitSha,
  command = 'wrangler',
  attempts = 3,
  retryDelayMs = 10_000,
  cwd = process.cwd(),
  runner = runCommand,
  timeoutMs = 600_000,
}: DeployCloudflarePagesOptions): Promise<CloudflarePagesSingleDeployment> {
  const resolvedDirectory = required(directory, 'directory');
  const resolvedProject = required(project, 'project');
  const resolvedCommitSha = required(commitSha, 'commitSha');
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new Error('attempts must be a positive integer');

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-'));
    const outputPath = join(outputDirectory, 'wrangler-output.json');
    try {
      const args = [
        'pages',
        'deploy',
        resolvedDirectory,
        `--project-name=${resolvedProject}`,
        ...(branch === null ? [] : [`--branch=${branch}`]),
        `--commit-hash=${resolvedCommitSha}`,
      ];
      const result = await runner(command, args, {
        cwd,
        env: {...process.env, WRANGLER_OUTPUT_FILE_PATH: outputPath},
        timeoutMs,
      });
      const structuredOutput = await readWranglerDeploymentOutput(outputPath);
      if (environment === 'production') {
        if (structuredOutput === undefined) {
          throw new Error(
            'Cloudflare did not return structured deployment metadata for the production upload',
          );
        }
        if (structuredOutput.environment !== 'production') {
          throw new Error(
            `Cloudflare deployment resolved to the ${typeof structuredOutput.environment === 'string' ? structuredOutput.environment : 'missing'} environment instead of production`,
          );
        }
        if (
          typeof structuredOutput.production_branch !== 'string' ||
          structuredOutput.production_branch.length === 0 ||
          branch === null ||
          branch.length === 0 ||
          structuredOutput.production_branch !== branch
        ) {
          throw new Error(
            `Cloudflare Pages production branch is ${typeof structuredOutput.production_branch === 'string' ? structuredOutput.production_branch : 'missing'}, expected ${branch !== null && branch.length > 0 ? branch : 'an explicit branch'}`,
          );
        }
      }
      const url = getCloudflareDeploymentUrl(result.output, structuredOutput);
      if (url === null) throw new Error('Cloudflare did not return a pages.dev deployment URL');

      return {
        url,
        directory: resolvedDirectory,
        project: resolvedProject,
        branch,
        commitSha: resolvedCommitSha,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) await wait(attempt * retryDelayMs);
    } finally {
      await rm(outputDirectory, {recursive: true, force: true});
    }
  }

  throw new Error(
    `Cloudflare Pages Direct Upload failed after ${attempts} attempt(s): ${
      lastError instanceof Error ? lastError.message : lastError
    }`,
  );
}

/**
 * Resolve a Cloudflare Pages branch from an environment configuration.
 * Production deployments always use an explicit branch because Wrangler may
 * infer a detached-checkout ref such as `HEAD` when the branch is omitted.
 */
export function resolvePagesBranch({
  environment = 'preview',
  branch,
  environments = defaultCloudflarePagesEnvironments,
  pullRequest = process.env.CLOUDFLARE_PAGES_PR_NUMBER,
}: {
  environment?: string;
  branch?: string | null | undefined;
  environments?: Record<string, CloudflarePagesEnvironment>;
  pullRequest?: string | undefined;
} = {}) {
  if (branch !== undefined) return branch;

  const configuredBranch = environments[environment]?.branch;
  if (configuredBranch === null) return environment === 'production' ? 'main' : null;
  if (configuredBranch !== undefined) {
    if (configuredBranch.includes('{pullRequest}') && !pullRequest) {
      throw new Error(`A pull request number is required for the ${environment} Pages branch`);
    }
    return configuredBranch
      .replaceAll('{pullRequest}', pullRequest ?? 'main')
      .replaceAll('{branch}', process.env.GITHUB_HEAD_REF ?? 'main');
  }

  if (environment === 'production') return 'main';
  if (environment === 'staging') return 'staging';
  if (pullRequest === undefined || pullRequest.length === 0) {
    throw new Error(`A pull request number is required for the ${environment} Pages branch`);
  }
  return `pr-${pullRequest}`;
}

/**
 * Upload one static directory to a Cloudflare Pages project.
 */
export function deployPages({
  directory = process.env.CLOUDFLARE_PAGES_DIRECTORY,
  project = process.env.CLOUDFLARE_PAGES_PROJECT,
  environment = 'preview',
  environments = defaultCloudflarePagesEnvironments,
  branch,
  commitSha = process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
  command,
  attempts,
  retryDelayMs,
  cwd,
  runner,
  timeoutMs,
}: {
  directory?: string | undefined;
  project?: string | undefined;
  environment?: string | undefined;
  environments?: Record<string, CloudflarePagesEnvironment> | undefined;
  branch?: string | null | undefined;
  commitSha?: string | undefined;
  command?: string | undefined;
  attempts?: number | undefined;
  retryDelayMs?: number | undefined;
  cwd?: string | undefined;
  runner?: CommandRunner | undefined;
  timeoutMs?: number | undefined;
}): Promise<CloudflarePagesSingleDeployment & {environment: string}> {
  return deployCloudflarePages({
    directory,
    project,
    environment,
    branch: resolvePagesBranch({environment, branch, environments}),
    commitSha,
    command,
    attempts,
    retryDelayMs,
    cwd,
    runner,
    timeoutMs,
  }).then((deployment) => ({...deployment, environment}));
}

export type CloudflarePagesDeployment = {
  appId: string;
  ok: boolean;
  directory: string;
  project: string;
  environment: string;
  branch: string | null;
  commitSha: string;
  url?: string;
  attempts?: number;
  error?: string;
};

/**
 * Upload each selected application to its Cloudflare Pages project.
 * Individual failures are collected so the caller can report every app.
 */
export async function deployCloudflarePagesApps({
  apps,
  selectedAppIds = apps.map((app) => app.id),
  environment = 'preview',
  environments = defaultCloudflarePagesEnvironments,
  branch,
  commitSha = process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
  command,
  attempts,
  retryDelayMs,
  cwd,
  runner,
}: {
  apps: CloudflarePagesApp[];
  selectedAppIds?: string[];
  environment?: string;
  environments?: Record<string, CloudflarePagesEnvironment>;
  branch?: string | null | undefined;
  commitSha?: string | undefined;
  command?: string | undefined;
  attempts?: number | undefined;
  retryDelayMs?: number | undefined;
  cwd?: string | undefined;
  runner?: CommandRunner | undefined;
}): Promise<{ok: boolean; apps: CloudflarePagesDeployment[]; errors: string[]}> {
  const resolvedCommitSha = required(commitSha, 'commitSha');
  const selected = apps.filter((app) => selectedAppIds.includes(app.id));
  if (selected.length === 0) {
    return {
      ok: false,
      apps: [],
      errors: ['No applications were selected for deployment'],
    };
  }
  const resolvedBranch = resolvePagesBranch({environment, branch, environments});
  const deployments: CloudflarePagesDeployment[] = [];

  for (const app of selected) {
    try {
      const project = app.projects?.[environment] ?? app.project;
      const deployment = await deployPages({
        environment,
        environments,
        directory: app.directory,
        project,
        branch: resolvedBranch,
        commitSha: resolvedCommitSha,
        command,
        attempts,
        retryDelayMs,
        cwd,
        runner,
      });
      deployments.push({appId: app.id, ok: true, ...deployment});
    } catch (error) {
      const project = app.projects?.[environment] ?? app.project;
      deployments.push({
        appId: app.id,
        ok: false,
        directory: app.directory,
        project,
        environment,
        branch: resolvedBranch,
        commitSha: resolvedCommitSha,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const errors = deployments
    .filter((deployment) => !deployment.ok)
    .map((deployment) => `${deployment.appId}: ${deployment.error}`);

  return {ok: errors.length === 0, apps: deployments, errors};
}
