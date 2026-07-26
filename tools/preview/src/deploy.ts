import {spawn} from 'node:child_process';

const pagesDevUrlPattern = /https:\/\/[A-Za-z0-9.-]+\.pages\.dev\/?/g;
const trailingSlashPattern = /\/$/;

function required(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Run an external provider CLI while preserving its output for CI logs.
 */
export function runCommand(
  command,
  args,
  {cwd = process.cwd(), env = process.env, input, stream = true} = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      if (stream) process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      if (stream) process.stderr.write(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({code, output});
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${output.trim()}`));
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function getCloudflareDeploymentUrl(output) {
  const match = output.match(pagesDevUrlPattern);
  return match?.at(-1)?.replace(trailingSlashPattern, '') ?? null;
}

/**
 * Upload a static directory to Cloudflare Pages through Direct Upload.
 */
export async function deployCloudflarePages({
  directory,
  project,
  branch,
  commitSha,
  command = 'wrangler',
  attempts = 3,
  retryDelayMs = 10_000,
  cwd = process.cwd(),
  runner = runCommand,
}) {
  required(directory, 'directory');
  required(project, 'project');
  required(branch, 'branch');
  required(commitSha, 'commitSha');
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new Error('attempts must be a positive integer');

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await runner(
        command,
        [
          'pages',
          'deploy',
          directory,
          `--project-name=${project}`,
          `--branch=${branch}`,
          `--commit-hash=${commitSha}`,
        ],
        {cwd},
      );
      const url = getCloudflareDeploymentUrl(result.output);
      if (url === null) throw new Error('Cloudflare did not return a pages.dev deployment URL');

      return {
        provider: 'cloudflare-pages',
        url,
        directory,
        project,
        branch,
        commitSha,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) await wait(attempt * retryDelayMs);
    }
  }

  throw new Error(
    `Cloudflare Pages Direct Upload failed after ${attempts} attempt(s): ${
      lastError instanceof Error ? lastError.message : lastError
    }`,
  );
}

function getBranch(branch = process.env.PREVIEW_BRANCH) {
  if (branch !== undefined && branch.length > 0) return branch;
  const pullRequest = process.env.PREVIEW_PR_NUMBER;
  return pullRequest === undefined || pullRequest.length === 0 ? 'main' : `pr-${pullRequest}`;
}

/**
 * Publish a static preview through a registered provider adapter.
 */
export function deployPreview({
  provider = process.env.PREVIEW_PROVIDER ?? 'cloudflare-pages',
  directory = process.env.PREVIEW_DIRECTORY,
  project = process.env.CLOUDFLARE_PAGES_PROJECT,
  branch,
  commitSha = process.env.PREVIEW_COMMIT_SHA ?? process.env.GITHUB_SHA,
  ...options
}) {
  const deploymentOptions = {
    directory,
    project,
    branch: getBranch(branch),
    commitSha,
    ...options,
  };

  if (provider === 'cloudflare-pages') return deployCloudflarePages(deploymentOptions);
  throw new Error(`Unsupported preview provider: ${provider}`);
}
