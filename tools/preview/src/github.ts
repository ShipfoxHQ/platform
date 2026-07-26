import {runCommand} from './deploy.js';

function required(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function parseJsonOutput(output, command) {
  try {
    return JSON.parse(output);
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
}) {
  required(repository, 'repository');
  const result = await runner(
    command,
    ['api', '--method', 'POST', `repos/${repository}/${path}`, '--input', '-'],
    {cwd, input: JSON.stringify(payload), stream: false},
  );
  return parseJsonOutput(result.output, 'GitHub API');
}

/**
 * Confirm that a pull request still points at the commit being previewed.
 * This closes the race between a queued build and a later commit pushed to
 * the same pull request.
 */
export async function assertCurrentPreviewCommit({
  repository = process.env.GITHUB_REPOSITORY,
  pullRequest = process.env.PREVIEW_PR_NUMBER,
  commit = process.env.PREVIEW_COMMIT_SHA ?? process.env.GITHUB_SHA,
  command = 'gh',
  cwd,
  runner = runCommand,
}) {
  required(repository, 'repository');
  required(pullRequest, 'pullRequest');
  required(commit, 'commit');

  const result = await runner(
    command,
    ['api', `repos/${repository}/pulls/${pullRequest}`, '--jq', '.head.sha'],
    {cwd, stream: false},
  );
  const currentCommit = result.output.trim();
  if (currentCommit !== commit) {
    throw new Error(
      `Preview commit ${commit} is no longer current; pull request ${pullRequest} now points to ${currentCommit || 'an unknown commit'}`,
    );
  }

  return {pullRequest: String(pullRequest), commit};
}

/**
 * Create a transient GitHub deployment and mark its first status in progress.
 */
export async function createGitHubDeployment({
  repository = process.env.GITHUB_REPOSITORY,
  ref,
  environment = 'preview',
  description,
  pullRequest = process.env.PREVIEW_PR_NUMBER ?? '',
  url,
  command,
  cwd,
  runner,
}) {
  required(ref, 'ref');
  required(environment, 'environment');
  required(url, 'url');

  const deployment = await callGitHubApi({
    repository,
    path: 'deployments',
    payload: {
      ref,
      task: 'deploy',
      auto_merge: false,
      required_contexts: [],
      environment,
      description: description ?? `Preview for ${ref}`,
      transient_environment: true,
      production_environment: false,
      payload: {
        repository,
        commitSha: ref,
        pullRequest,
      },
    },
    command,
    cwd,
    runner,
  });
  if (deployment.id === undefined || deployment.id === null) {
    throw new Error('GitHub deployment response did not contain an id');
  }
  const deploymentId = String(deployment.id);

  await finishGitHubDeployment({
    repository,
    deploymentId,
    state: 'in_progress',
    url,
    description: 'Preview upload completed; verifying endpoints',
    command,
    cwd,
    runner,
  });

  return {id: deploymentId, url, environment, repository};
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
}) {
  required(deploymentId, 'deploymentId');
  required(state, 'state');
  required(url, 'url');

  await callGitHubApi({
    repository,
    path: `deployments/${deploymentId}/statuses`,
    payload: {
      state,
      target_url: url,
      environment_url: url,
      description:
        description ??
        (state === 'success'
          ? 'Verified preview for the exact commit'
          : 'Preview failed post-deployment verification'),
    },
    command,
    cwd,
    runner,
  });

  return {id: deploymentId, state, url};
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
}) {
  required(repository, 'repository');
  required(runId, 'runId');
  const result = await runner(command, ['api', `repos/${repository}/actions/runs/${runId}`], {
    cwd,
    stream: false,
  });
  const metadata = parseJsonOutput(result.output, 'GitHub Actions API');
  const createdAt = Date.parse(metadata.created_at);
  const startedAt = Date.parse(metadata.run_started_at);
  if (!Number.isFinite(createdAt) || !Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.round((startedAt - createdAt) / 1000));
}
