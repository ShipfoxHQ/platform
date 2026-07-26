import {type CommandRunner, runCommand} from './deploy.js';

type JsonObject = Record<string, unknown>;

type RunnerOptions = {
  command?: string | undefined;
  cwd?: string | undefined;
  runner?: CommandRunner | undefined;
  timeoutMs?: number | undefined;
};

type GitHubDeploymentRecord = {
  id: string;
  url: string;
  environment: string;
  repository: string;
};

export type GitHubDeployment = GitHubDeploymentRecord & {appId: string};

type GitHubVerification = {
  apps: Array<{appId: string; ok: boolean}>;
};

class GitHubDeploymentStatusError extends Error {
  deployment: GitHubDeploymentRecord;

  constructor(message: string, deployment: GitHubDeploymentRecord) {
    super(message);
    this.name = 'GitHubDeploymentStatusError';
    this.deployment = deployment;
  }
}

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function deploymentEnvironmentName(
  environment: string,
  appId: string,
  pullRequest: string,
): string {
  const pullRequestSuffix = environment === 'Preview' && pullRequest ? ` – PR ${pullRequest}` : '';
  return `${environment} – ${appId}${pullRequestSuffix}`;
}

function deploymentEnvironmentSettings(environment: string): {
  label: string;
  transient: boolean;
  production: boolean;
} {
  const settings = {
    preview: {label: 'Preview', transient: true, production: false},
    staging: {label: 'Staging', transient: false, production: false},
    production: {label: 'Production', transient: false, production: true},
  }[environment as 'preview' | 'staging' | 'production'];
  return settings ?? {label: environment, transient: false, production: false};
}

function parseJsonOutput(output: string, command: string): JsonObject {
  try {
    const value: unknown = JSON.parse(output);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('response was not a JSON object');
    }
    return value as JsonObject;
  } catch (error) {
    throw new Error(
      `${command} did not return JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function callGitHubApi({
  repository,
  path,
  payload,
  command = 'gh',
  cwd,
  runner = runCommand,
  timeoutMs = 60_000,
}: RunnerOptions & {
  repository?: string | undefined;
  path: string;
  payload: unknown;
}): Promise<JsonObject> {
  const resolvedRepository = required(repository, 'repository');
  const result = await runner(
    command,
    ['api', '--method', 'POST', `repos/${resolvedRepository}/${path}`, '--input', '-'],
    {cwd, input: JSON.stringify(payload), stream: false, timeoutMs},
  );
  return parseJsonOutput(result.output, 'GitHub API');
}

/**
 * Confirm that a pull request still points at the commit being deployed.
 * This closes the race between a queued build and a later commit pushed to
 * the same pull request.
 */
export async function assertCurrentCommit({
  repository = process.env.GITHUB_REPOSITORY,
  pullRequest = process.env.CLOUDFLARE_PAGES_PR_NUMBER,
  commit = process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
  command = 'gh',
  cwd,
  runner = runCommand,
  timeoutMs = 60_000,
}: RunnerOptions & {
  repository?: string | undefined;
  pullRequest?: string | undefined;
  commit?: string | undefined;
}): Promise<{pullRequest: string; commit: string}> {
  const resolvedRepository = required(repository, 'repository');
  const resolvedPullRequest = required(pullRequest, 'pullRequest');
  const resolvedCommit = required(commit, 'commit');

  const result = await runner(
    command,
    ['api', `repos/${resolvedRepository}/pulls/${resolvedPullRequest}`, '--jq', '.head.sha'],
    {cwd, stream: false, timeoutMs},
  );
  const currentCommit = result.output.trim();
  if (currentCommit !== resolvedCommit) {
    throw new Error(
      `Deployment commit ${resolvedCommit} is no longer current; pull request ${resolvedPullRequest} now points to ${currentCommit || 'an unknown commit'}`,
    );
  }

  return {pullRequest: resolvedPullRequest, commit: resolvedCommit};
}

/**
 * Create a GitHub deployment and mark its first status in progress.
 */
export async function createGitHubDeployment({
  repository = process.env.GITHUB_REPOSITORY,
  ref,
  environment = 'Preview',
  description,
  pullRequest = process.env.CLOUDFLARE_PAGES_PR_NUMBER ?? '',
  transientEnvironment = true,
  productionEnvironment = false,
  url,
  command,
  cwd,
  runner,
  timeoutMs,
}: RunnerOptions & {
  repository?: string | undefined;
  ref?: string | undefined;
  environment?: string | undefined;
  description?: string | undefined;
  pullRequest?: string | undefined;
  transientEnvironment?: boolean | undefined;
  productionEnvironment?: boolean | undefined;
  url?: string | undefined;
}): Promise<GitHubDeploymentRecord> {
  const resolvedRepository = required(repository, 'repository');
  const resolvedRef = required(ref, 'ref');
  const resolvedEnvironment = required(environment, 'environment');
  const resolvedUrl = required(url, 'url');

  const deployment = await callGitHubApi({
    repository: resolvedRepository,
    path: 'deployments',
    payload: {
      ref: resolvedRef,
      task: 'deploy',
      auto_merge: false,
      required_contexts: [],
      environment: resolvedEnvironment,
      description: description ?? `Cloudflare Pages deployment for ${resolvedRef}`,
      transient_environment: transientEnvironment,
      production_environment: productionEnvironment,
      payload: {
        repository: resolvedRepository,
        commitSha: resolvedRef,
        pullRequest,
      },
    },
    command,
    cwd,
    runner,
    timeoutMs,
  });
  if (deployment.id === undefined || deployment.id === null) {
    throw new Error('GitHub deployment response did not contain an id');
  }
  const deploymentId = String(deployment.id);

  const createdDeployment = {
    id: deploymentId,
    url: resolvedUrl,
    environment: resolvedEnvironment,
    repository: resolvedRepository,
  };

  try {
    await finishGitHubDeployment({
      repository: resolvedRepository,
      deploymentId,
      state: 'in_progress',
      url: resolvedUrl,
      description: 'Cloudflare Pages upload completed; verifying endpoints',
      command,
      cwd,
      runner,
      timeoutMs,
    });
  } catch (error) {
    throw new GitHubDeploymentStatusError(
      `GitHub deployment ${deploymentId} was created but could not be marked in progress: ${error instanceof Error ? error.message : String(error)}`,
      createdDeployment,
    );
  }

  return createdDeployment;
}

/**
 * Update a GitHub deployment status after verification.
 */
export async function finishGitHubDeployment({
  repository = process.env.GITHUB_REPOSITORY,
  deploymentId,
  state,
  url,
  description,
  command,
  cwd,
  runner,
  timeoutMs,
}: RunnerOptions & {
  repository?: string | undefined;
  deploymentId?: string | undefined;
  state?: string | undefined;
  url?: string | undefined;
  description?: string | undefined;
}): Promise<{id: string; state: string; url: string}> {
  const resolvedDeploymentId = required(deploymentId, 'deploymentId');
  const resolvedState = required(state, 'state');
  const resolvedUrl = required(url, 'url');

  await callGitHubApi({
    repository,
    path: `deployments/${resolvedDeploymentId}/statuses`,
    payload: {
      state: resolvedState,
      target_url: resolvedUrl,
      environment_url: resolvedUrl,
      description:
        description ??
        (resolvedState === 'success'
          ? 'Verified deployment for the exact commit'
          : 'Cloudflare Pages deployment failed post-deployment verification'),
    },
    command,
    cwd,
    runner,
    timeoutMs,
  });

  return {id: resolvedDeploymentId, state: resolvedState, url: resolvedUrl};
}

/**
 * Create one GitHub deployment per successfully uploaded application.
 */
export async function createGitHubDeployments({
  deployments,
  ref,
  environment = 'preview',
  pullRequest = process.env.CLOUDFLARE_PAGES_PR_NUMBER ?? '',
  repository = process.env.GITHUB_REPOSITORY,
  command,
  cwd,
  runner,
  timeoutMs,
}: RunnerOptions & {
  deployments: Array<{
    appId: string;
    ok: boolean;
    url?: string;
  }>;
  ref?: string | undefined;
  environment?: string | undefined;
  pullRequest?: string | undefined;
  repository?: string | undefined;
}): Promise<{ok: boolean; apps: GitHubDeployment[]; errors: string[]}> {
  const resolvedRepository = required(repository, 'repository');
  const resolvedRef = required(ref, 'ref');
  const created: GitHubDeployment[] = [];
  const errors: string[] = [];
  const settings = deploymentEnvironmentSettings(environment);
  const eligibleDeployments = deployments.filter(
    (deployment) => deployment.ok && deployment.url !== undefined,
  );
  if (eligibleDeployments.length === 0) {
    return {
      ok: false,
      apps: [],
      errors: ['No successful deployments were available for GitHub registration'],
    };
  }

  for (const deployment of eligibleDeployments) {
    try {
      const githubDeployment = await createGitHubDeployment({
        repository: resolvedRepository,
        ref: resolvedRef,
        url: deployment.url,
        environment: deploymentEnvironmentName(settings.label, deployment.appId, pullRequest),
        description: `${settings.label} deployment for ${deployment.appId} at ${resolvedRef}`,
        pullRequest,
        transientEnvironment: settings.transient,
        productionEnvironment: settings.production,
        command,
        cwd,
        runner,
        timeoutMs,
      });
      created.push({appId: deployment.appId, ...githubDeployment});
    } catch (error) {
      if (error instanceof GitHubDeploymentStatusError) {
        created.push({appId: deployment.appId, ...error.deployment});
      }
      errors.push(`${deployment.appId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {ok: errors.length === 0, apps: created, errors};
}

/**
 * Finalize one GitHub deployment per application after aggregate verification.
 */
export async function finishGitHubDeployments({
  deployments,
  verification,
  command,
  cwd,
  runner,
  timeoutMs,
}: RunnerOptions & {
  deployments: GitHubDeployment[];
  verification: GitHubVerification;
}): Promise<{
  ok: boolean;
  apps: Array<{appId: string; id: string; state: string; url: string}>;
  errors: string[];
}> {
  const reports = new Map(verification.apps.map((report) => [report.appId, report]));
  const finalized: Array<{appId: string; id: string; state: string; url: string}> = [];
  const errors: string[] = [];

  for (const deployment of deployments) {
    const report = reports.get(deployment.appId);
    const state = report?.ok === true ? 'success' : 'failure';
    try {
      const result = await finishGitHubDeployment({
        repository: deployment.repository,
        deploymentId: deployment.id,
        state,
        url: deployment.url,
        description:
          state === 'success'
            ? `Verified ${deployment.appId} deployment for the exact commit`
            : `Failed ${deployment.appId} deployment verification`,
        command,
        cwd,
        runner,
        timeoutMs,
      });
      finalized.push({appId: deployment.appId, ...result});
    } catch (error) {
      errors.push(`${deployment.appId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {ok: errors.length === 0, apps: finalized, errors};
}

/**
 * Read the workflow run timestamps and return queue duration in seconds.
 */
export async function getWorkflowQueueSeconds({
  repository = process.env.GITHUB_REPOSITORY,
  runId = process.env.GITHUB_RUN_ID,
  command = 'gh',
  cwd,
  runner = runCommand,
  timeoutMs = 60_000,
}: RunnerOptions & {
  repository?: string | undefined;
  runId?: string | undefined;
}): Promise<number | null> {
  const resolvedRepository = required(repository, 'repository');
  const resolvedRunId = required(runId, 'runId');
  const result = await runner(
    command,
    ['api', `repos/${resolvedRepository}/actions/runs/${resolvedRunId}`],
    {
      cwd,
      stream: false,
      timeoutMs,
    },
  );
  const metadata = parseJsonOutput(result.output, 'GitHub Actions API');
  const createdAt = typeof metadata.created_at === 'string' ? Date.parse(metadata.created_at) : NaN;
  const startedAt =
    typeof metadata.run_started_at === 'string' ? Date.parse(metadata.run_started_at) : NaN;
  if (!Number.isFinite(createdAt) || !Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.round((startedAt - createdAt) / 1000));
}
