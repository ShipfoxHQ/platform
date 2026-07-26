import {type CommandRunner, runCommand} from './deploy.js';
import type {CloudflarePagesApp} from './plan.js';

type BuildResult = {
  appId: string;
  target: string;
  task: string;
  environment: string;
  ok: boolean;
  env?: string[];
  error?: string;
};

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function replaceBuildTemplate(
  value: string,
  {
    pullRequest,
    branch,
    commitSha,
  }: {
    pullRequest?: string | undefined;
    branch?: string | undefined;
    commitSha?: string | undefined;
  },
): string {
  return value
    .replaceAll('{pullRequest}', pullRequest || 'main')
    .replaceAll('{branch}', branch || 'main')
    .replaceAll('{commit}', commitSha || '');
}

/**
 * Resolve the build environment declared by one application.
 * Values in the repository config are public build inputs. `fromEnv` values
 * are read from the CI environment without being copied into the config.
 */
export function resolveBuildEnvironment({
  app,
  environment = 'preview',
  pullRequest = process.env.CLOUDFLARE_PAGES_PR_NUMBER,
  branch = process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME,
  commitSha = process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
  env = process.env,
}: {
  app: CloudflarePagesApp;
  environment?: string | undefined;
  pullRequest?: string | undefined;
  branch?: string | undefined;
  commitSha?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}): Record<string, string> {
  const values = app.build?.env?.[environment] ?? {};
  const resolved: Record<string, string> = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      replaceBuildTemplate(value, {pullRequest, branch, commitSha}),
    ]),
  );

  for (const [name, source] of Object.entries(app.build?.fromEnv ?? {})) {
    const value = env[source];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `Build environment variable ${name} is mapped from missing CI environment variable ${source}`,
      );
    }
    resolved[name] = value;
  }

  return resolved;
}

/**
 * Build each selected application with its repository-configured environment.
 * Applications are built separately so each one may have different values.
 */
export async function buildCloudflarePagesApps({
  apps,
  selectedAppIds = apps.map((app) => app.id),
  environment = 'preview',
  pullRequest,
  branch,
  commitSha,
  concurrency = 4,
  command = 'turbo',
  cwd = process.cwd(),
  env = process.env,
  runner = runCommand,
  timeoutMs = 1_800_000,
}: {
  apps: CloudflarePagesApp[];
  selectedAppIds?: string[];
  environment?: string | undefined;
  pullRequest?: string | undefined;
  branch?: string | undefined;
  commitSha?: string | undefined;
  concurrency?: string | number | undefined;
  command?: string | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  runner?: CommandRunner | undefined;
  timeoutMs?: number | undefined;
}): Promise<{ok: boolean; apps: BuildResult[]; errors: string[]}> {
  required(environment, 'environment');
  const selected = apps.filter((app) => selectedAppIds.includes(app.id));
  const prepared = selected.map((app) => ({
    app,
    task: app.build?.task ?? 'build',
    buildEnv: resolveBuildEnvironment({
      app,
      environment,
      pullRequest,
      branch,
      commitSha,
      env,
    }),
  }));
  const builds: BuildResult[] = [];

  for (const {app, task, buildEnv} of prepared) {
    try {
      await runner(
        command,
        ['run', task, `--filter=${app.target}...`, `--concurrency=${concurrency}`],
        {
          cwd,
          env: {...env, ...buildEnv},
          timeoutMs,
        },
      );
      builds.push({
        appId: app.id,
        target: app.target,
        task,
        environment,
        ok: true,
        env: Object.keys(buildEnv),
      });
    } catch (error) {
      builds.push({
        appId: app.id,
        target: app.target,
        task,
        environment,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const errors = builds
    .filter((build) => !build.ok)
    .map((build) => `${build.appId}: ${build.error}`);

  return {ok: errors.length === 0, apps: builds, errors};
}
