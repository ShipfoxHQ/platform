import {appendFile, cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {parse, relative, resolve, sep} from 'node:path';
import {buildCloudflarePagesApps} from './build.js';
import {
  type CloudflarePagesDeployment,
  deployCloudflarePagesApps,
  deployPages,
  runCommand,
} from './deploy.js';
import type {GitHubDeployment} from './github.js';
import {
  assertCurrentCommit,
  createGitHubDeployment,
  createGitHubDeployments,
  finishGitHubDeployment,
  finishGitHubDeployments,
  getWorkflowQueueSeconds,
} from './github.js';
import {
  type CloudflarePagesConfig,
  createCloudflarePagesPlan,
  readCloudflarePagesConfig,
} from './plan.js';
import {verifyCloudflarePagesApps, verifyPagesDeployment} from './verify.js';

const turboSummaryLinePattern = /^(Tasks:|Cached:|Time:)/;
type CliOptions = Record<string, string | boolean | Array<string | boolean>> & {
  output?: string;
  githubOutput?: string;
};

type DeploymentPlan = {
  shouldDeploy: boolean | string;
  reason: string;
  selectedApps: string[];
  affectedTargets: string[];
};

type DeploymentManifest = {apps: CloudflarePagesDeployment[]};

type VerificationSummary = {
  ok?: boolean;
  commitSha?: string | undefined;
  apps: Array<{appId: string; ok: boolean; errors?: string[] | undefined}>;
};

const archiveAppIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function toOptionName(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function addOption(options: CliOptions, name: string, value: string | boolean): void {
  if (options[name] === undefined) {
    options[name] = value;
    return;
  }
  options[name] = Array.isArray(options[name]) ? [...options[name], value] : [options[name], value];
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) throw new Error('Unexpected missing argument');
    if (argument === '--') continue;
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const name = toOptionName(argument.slice(2));
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      addOption(options, name, true);
      continue;
    }
    addOption(options, name, next);
    index += 1;
  }
  return options;
}

function option(options: CliOptions, name: string, fallback?: string): string | undefined {
  const value = options[name];
  return typeof value === 'string' ? value : fallback;
}

function requiredOption(options: CliOptions, name: string): string {
  const value = option(options, name);
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

async function writeJson(path: string | undefined, value: unknown): Promise<void> {
  if (path === undefined) return;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeGitHubOutput(
  path: string | undefined,
  outputs: Record<string, unknown>,
): Promise<void> {
  if (path === undefined) return;
  const lines = Object.entries(outputs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${name}=${String(value).replaceAll('\n', ' ')}`);
  await appendFile(path, `${lines.join('\n')}\n`, 'utf8');
}

function configPath(options: CliOptions): string {
  return (
    option(options, 'config', 'cloudflare-pages.config.json') ?? 'cloudflare-pages.config.json'
  );
}

async function runPlan(options: CliOptions): Promise<void> {
  const config = await readCloudflarePagesConfig(configPath(options));
  const plan = createCloudflarePagesPlan({
    apps: config.apps,
    forcePaths: config.forcePaths,
    eventName: option(options, 'event'),
  });
  await writeJson(options.output, plan);
  await writeGitHubOutput(options.githubOutput, {
    should_deploy: plan.shouldDeploy,
    reason: plan.reason,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function runDeploy(options: CliOptions): Promise<void> {
  const startedAt = Date.now();
  const deployment = await deployPages({
    directory: option(options, 'directory'),
    project: option(options, 'project'),
    environment: option(options, 'environment', 'preview') ?? 'preview',
    branch: option(options, 'branch'),
    commitSha: option(options, 'commit'),
  });
  const result = {...deployment, durationSeconds: Math.round((Date.now() - startedAt) / 1000)};
  await writeJson(options.output, result);
  await writeGitHubOutput(options.githubOutput, {
    url: result.url,
    deployment_url: result.url,
    deployment_seconds: result.durationSeconds,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runDeployApps(options: CliOptions): Promise<void> {
  const config = await readCloudflarePagesConfig(configPath(options));
  const artifactDirectory = option(options, 'artifactDirectory');
  const plan: Pick<DeploymentPlan, 'selectedApps'> = option(options, 'planFile')
    ? await readJson<Pick<DeploymentPlan, 'selectedApps'>>(requiredOption(options, 'planFile'))
    : {selectedApps: config.apps.map((app) => app.id)};
  const apps =
    artifactDirectory === undefined
      ? config.apps
      : config.apps.map((app) => ({
          ...app,
          directory: archiveAppDirectory(artifactDirectory, app.id),
        }));
  if (artifactDirectory !== undefined) {
    await Promise.all(
      apps
        .filter((app) => plan.selectedApps?.includes(app.id))
        .map((app) => assertStaticArtifactDirectory(app.directory)),
    );
  }

  const startedAt = Date.now();
  const result = await deployCloudflarePagesApps({
    apps,
    selectedAppIds: plan.selectedApps ?? [],
    environment: option(options, 'environment', 'preview') ?? 'preview',
    environments: config.environments,
    branch: option(options, 'branch'),
    commitSha: option(options, 'commit'),
  });
  const resultWithDuration = {
    ...result,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  await writeJson(options.output, resultWithDuration);
  await writeGitHubOutput(options.githubOutput, {
    deployment_count: resultWithDuration.apps.length,
    deployment_ok: resultWithDuration.ok,
    deployment_seconds: resultWithDuration.durationSeconds,
  });
  process.stdout.write(`${JSON.stringify(resultWithDuration, null, 2)}\n`);
  if (!resultWithDuration.ok) throw new Error(resultWithDuration.errors.join('; '));
}

async function runBuildApps(options: CliOptions): Promise<void> {
  const config = await readCloudflarePagesConfig(configPath(options));
  const plan: Pick<DeploymentPlan, 'selectedApps'> = option(options, 'planFile')
    ? await readJson<Pick<DeploymentPlan, 'selectedApps'>>(requiredOption(options, 'planFile'))
    : {selectedApps: config.apps.map((app) => app.id)};
  const startedAt = Date.now();
  const result = await buildCloudflarePagesApps({
    apps: config.apps,
    selectedAppIds: plan.selectedApps ?? [],
    environment: option(options, 'environment', 'preview'),
    pullRequest: option(options, 'pullRequest'),
    branch: option(options, 'branch'),
    commitSha: option(options, 'commit'),
    concurrency: option(options, 'concurrency', '4'),
  });
  const resultWithDuration = {
    ...result,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  await writeJson(options.output, resultWithDuration);
  await writeGitHubOutput(options.githubOutput, {
    build_count: resultWithDuration.apps.length,
    build_ok: resultWithDuration.ok,
    build_seconds: resultWithDuration.durationSeconds,
  });
  process.stdout.write(`${JSON.stringify(resultWithDuration, null, 2)}\n`);
  if (!resultWithDuration.ok) throw new Error(resultWithDuration.errors.join('; '));
}

async function runValidate(options: CliOptions): Promise<void> {
  const config = await readCloudflarePagesConfig(configPath(options));
  const outputPath = option(options, 'output');
  const githubOutputPath = option(options, 'githubOutput');
  const validation = config.validation;

  if (validation === undefined) {
    const result = {ok: true, skipped: true, reason: 'no validation command configured'};
    await writeJson(outputPath, result);
    await writeGitHubOutput(githubOutputPath, {
      validation_ok: result.ok,
      validation_skipped: result.skipped,
      validation_seconds: 0,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const startedAt = Date.now();
  try {
    if (validation.setup !== undefined) {
      await runCommand(validation.setup.command, validation.setup.args ?? [], {
        timeoutMs: 1_800_000,
      });
    }
    await runCommand(validation.command, validation.args ?? [], {timeoutMs: 1_800_000});
  } catch (error) {
    const result = {
      ok: false,
      skipped: false,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
    await writeJson(outputPath, result);
    await writeGitHubOutput(githubOutputPath, {
      validation_ok: result.ok,
      validation_skipped: result.skipped,
      validation_seconds: result.durationSeconds,
    });
    throw error;
  }

  const result = {
    ok: true,
    skipped: false,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  await writeJson(outputPath, result);
  await writeGitHubOutput(githubOutputPath, {
    validation_ok: result.ok,
    validation_skipped: result.skipped,
    validation_seconds: result.durationSeconds,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function assertStaticArtifactDirectory(directory: string): Promise<void> {
  const entries = await readdir(directory, {withFileTypes: true});
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Archived application ${directory} contains a symbolic link`);
    }
    if (entry.name === '_worker.js') {
      throw new Error(`Archived application ${directory} contains executable Pages worker code`);
    }
    if (entry.isDirectory()) {
      await assertStaticArtifactDirectory(resolve(directory, entry.name));
    }
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !parse(pathFromRoot).root)
  );
}

function archiveAppDirectory(artifactDirectory: string, appId: string): string {
  if (!archiveAppIdPattern.test(appId) || appId === '.' || appId === '..') {
    throw new Error(`Application id ${appId} is not safe for an artifact directory`);
  }

  const archiveRoot = resolve(artifactDirectory);
  const appDirectory = resolve(archiveRoot, appId);
  if (!isPathWithin(archiveRoot, appDirectory) || appDirectory === archiveRoot) {
    throw new Error(`Application id ${appId} escapes the artifact directory`);
  }
  return appDirectory;
}

function assertSafeArchiveRoot({
  artifactDirectory,
  configFile,
  appDirectories,
}: {
  artifactDirectory: string;
  configFile: string;
  appDirectories: string[];
}): string {
  const archiveRoot = resolve(artifactDirectory);
  const workingDirectory = resolve(process.cwd());
  const filesystemRoot = parse(archiveRoot).root;
  if (archiveRoot === filesystemRoot) {
    throw new Error('The artifact directory cannot be a filesystem root');
  }
  if (isPathWithin(archiveRoot, workingDirectory)) {
    throw new Error('The artifact directory cannot contain the working directory');
  }

  const protectedPaths = [
    resolve(configFile),
    ...appDirectories.map((directory) => resolve(directory)),
  ];
  if (
    protectedPaths.some(
      (protectedPath) =>
        isPathWithin(archiveRoot, protectedPath) || isPathWithin(protectedPath, archiveRoot),
    )
  ) {
    throw new Error('The artifact directory cannot overlap the config or application outputs');
  }
  return archiveRoot;
}

async function runArchiveApps(options: CliOptions): Promise<void> {
  const configuredPath = configPath(options);
  const config = await readCloudflarePagesConfig(configuredPath);
  const plan: Partial<DeploymentPlan> & Pick<DeploymentPlan, 'selectedApps'> = option(
    options,
    'planFile',
  )
    ? await readJson<Partial<DeploymentPlan> & Pick<DeploymentPlan, 'selectedApps'>>(
        requiredOption(options, 'planFile'),
      )
    : {selectedApps: config.apps.map((app) => app.id)};
  const artifactDirectory = assertSafeArchiveRoot({
    artifactDirectory: requiredOption(options, 'artifactDirectory'),
    configFile: configuredPath,
    appDirectories: config.apps.map((app) => app.directory),
  });
  const selected = config.apps.filter((app) => plan.selectedApps?.includes(app.id));
  if (selected.length === 0) throw new Error('No applications were selected for archiving');

  await rm(artifactDirectory, {recursive: true, force: true});
  await mkdir(artifactDirectory, {recursive: true});
  for (const app of selected) {
    await cp(app.directory, archiveAppDirectory(artifactDirectory, app.id), {recursive: true});
  }

  const selectedApps = selected.map((app) => app.id);
  const result = {
    shouldDeploy: true,
    reason: plan.reason ?? 'verified artifact',
    selectedApps,
    affectedTargets: plan.affectedTargets ?? [],
    apps: selectedApps,
    directory: artifactDirectory,
  };
  await writeJson(option(options, 'output'), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runVerify(options: CliOptions): Promise<void> {
  const config = await readCloudflarePagesConfig(configPath(options));
  const app = config.apps[0];
  if (app === undefined) throw new Error('No Cloudflare Pages application is configured');
  const startedAt = Date.now();
  const result = await verifyPagesDeployment({
    baseUrl: option(options, 'url'),
    expectedCommitSha: option(options, 'commit'),
    expectedPullRequest: option(options, 'pullRequest'),
    metadataPath: app.verify?.metadataPath ?? '/preview-metadata.json',
    endpoints: app.verify?.endpoints ?? [],
  });
  const resultWithDuration = {
    ...result,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  await writeJson(options.output, resultWithDuration);
  await writeGitHubOutput(options.githubOutput, {
    verification_seconds: resultWithDuration.durationSeconds,
    verification_ok: resultWithDuration.ok,
  });
  process.stdout.write(
    `${resultWithDuration.ok ? 'Verified' : 'Verification failed'} ${resultWithDuration.url}: root, ${resultWithDuration.metadataPath}, and ${resultWithDuration.endpoints.length} endpoint(s)\n`,
  );
  if (!resultWithDuration.ok) throw new Error(resultWithDuration.errors.join('; '));
}

async function runVerifyApps(options: CliOptions): Promise<void> {
  const config = await readCloudflarePagesConfig(configPath(options));
  const deployments =
    (await readJson<DeploymentManifest>(requiredOption(options, 'deploymentsFile'))).apps ?? [];
  const plan: Pick<DeploymentPlan, 'selectedApps'> = option(options, 'planFile')
    ? await readJson<Pick<DeploymentPlan, 'selectedApps'>>(requiredOption(options, 'planFile'))
    : {selectedApps: deployments.map((deployment) => deployment.appId)};
  const startedAt = Date.now();
  const result = await verifyCloudflarePagesApps({
    apps: config.apps,
    deployments,
    selectedAppIds: plan.selectedApps ?? [],
    expectedCommitSha: option(options, 'commit'),
    expectedPullRequest: option(options, 'pullRequest'),
  });
  const resultWithDuration = {
    ...result,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  await writeJson(options.output, resultWithDuration);
  await writeGitHubOutput(options.githubOutput, {
    verification_count: resultWithDuration.apps.length,
    verification_ok: resultWithDuration.ok,
    verification_seconds: resultWithDuration.durationSeconds,
  });
  process.stdout.write(
    `${resultWithDuration.ok ? 'Verified' : 'Verification failed'} ${resultWithDuration.apps.length} Cloudflare Pages app(s)\n`,
  );
  if (!resultWithDuration.ok) throw new Error(resultWithDuration.errors.join('; '));
}

async function runGitHub(action: string, options: CliOptions): Promise<void> {
  if (action === 'assert-current') {
    const result = await assertCurrentCommit({
      repository: option(options, 'repository'),
      pullRequest: option(options, 'pullRequest'),
      commit: option(options, 'commit'),
    });
    await writeJson(options.output, result);
    await writeGitHubOutput(options.githubOutput, {current_sha: result.commit});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (action === 'create') {
    const result = await createGitHubDeployment({
      repository: option(options, 'repository'),
      ref: option(
        options,
        'ref',
        process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
      ),
      environment: option(options, 'environment'),
      description: option(options, 'description'),
      pullRequest: option(options, 'pullRequest'),
      url: option(options, 'url'),
    });
    await writeJson(options.output, result);
    await writeGitHubOutput(options.githubOutput, {deployment_id: result.id});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (action === 'create-all') {
    const deployments =
      (await readJson<DeploymentManifest>(requiredOption(options, 'deploymentsFile'))).apps ?? [];
    const result = await createGitHubDeployments({
      deployments,
      repository: option(options, 'repository'),
      ref: option(
        options,
        'ref',
        process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
      ),
      environment: option(options, 'environment'),
      pullRequest: option(options, 'pullRequest'),
    });
    await writeJson(options.output, result);
    await writeGitHubOutput(options.githubOutput, {
      deployment_count: result.apps.length,
      deployment_ok: result.ok,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) throw new Error(result.errors.join('; '));
    return;
  }

  if (action === 'status') {
    const result = await finishGitHubDeployment({
      repository: option(options, 'repository'),
      deploymentId: option(options, 'deploymentId'),
      state: option(options, 'state'),
      url: option(options, 'url'),
      description: option(options, 'description'),
    });
    await writeJson(options.output, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (action === 'status-all') {
    const deployments = readGitHubDeployments(
      await readJsonIfPresent<unknown>(option(options, 'deploymentsFile'), {apps: []}),
    );
    const verification = readVerificationSummary(
      await readJsonIfPresent<unknown>(option(options, 'verificationReport'), {apps: []}),
    );
    const result = await finishGitHubDeployments({deployments, verification});
    await writeJson(options.output, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) throw new Error(result.errors.join('; '));
    return;
  }

  if (action === 'queue') {
    const queueSeconds = await getWorkflowQueueSeconds({
      repository: option(options, 'repository'),
      runId: option(options, 'runId'),
    });
    await writeGitHubOutput(options.githubOutput, {
      queue_seconds: queueSeconds ?? 'unavailable',
    });
    process.stdout.write(`${queueSeconds ?? 'unavailable'}\n`);
    return;
  }

  throw new Error(`Unsupported github action: ${action}`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readJsonIfPresent<T>(path: string | undefined, fallback: T): Promise<T> {
  if (path === undefined) return fallback;
  try {
    return await readJson(path);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function objectWithApps(value: unknown, name: string): Record<string, unknown> & {apps: unknown[]} {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Array.isArray((value as Record<string, unknown>).apps)
  ) {
    throw new Error(`${name} must contain an apps array`);
  }
  return value as Record<string, unknown> & {apps: unknown[]};
}

function readGitHubDeployments(value: unknown): GitHubDeployment[] {
  const apps = objectWithApps(value, 'GitHub deployment manifest').apps;
  if (
    apps.some(
      (app) =>
        typeof app !== 'object' ||
        app === null ||
        typeof (app as Record<string, unknown>).appId !== 'string' ||
        typeof (app as Record<string, unknown>).id !== 'string' ||
        typeof (app as Record<string, unknown>).url !== 'string' ||
        typeof (app as Record<string, unknown>).environment !== 'string' ||
        typeof (app as Record<string, unknown>).repository !== 'string',
    )
  ) {
    throw new Error('GitHub deployment manifest contains an invalid application');
  }
  return apps as GitHubDeployment[];
}

function readVerificationSummary(value: unknown): VerificationSummary {
  const apps = objectWithApps(value, 'Verification report').apps;
  if (
    apps.some(
      (app) =>
        typeof app !== 'object' ||
        app === null ||
        typeof (app as Record<string, unknown>).appId !== 'string' ||
        typeof (app as Record<string, unknown>).ok !== 'boolean',
    )
  ) {
    throw new Error('Verification report contains an invalid application');
  }
  return {apps: apps as VerificationSummary['apps']};
}

async function readFileIfPresent(path: string | undefined): Promise<string> {
  if (path === undefined) return '';
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function getMetric(value: unknown): string {
  return value === undefined || value === '' ? 'unavailable' : String(value);
}

function markdownCell(value: unknown): string {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function artifactStatus(): string {
  const archiveResult = process.env.ARTIFACT_RESULT;
  const uploadResult = process.env.ARTIFACT_UPLOAD_RESULT;
  if (archiveResult === 'success' && uploadResult === 'success') {
    return '✅ verified artifact ready';
  }
  return `❌ artifact unavailable (archive: ${getMetric(archiveResult)}, upload: ${getMetric(uploadResult)})`;
}

function appStatus({
  plan,
  deployment,
  report,
  appId,
}: {
  plan: Pick<DeploymentPlan, 'shouldDeploy' | 'selectedApps'>;
  deployment: CloudflarePagesDeployment | undefined;
  report: VerificationSummary | null;
  appId: string;
}): string {
  if (plan.shouldDeploy !== true || !plan.selectedApps?.includes(appId)) {
    return 'Not synced for this commit';
  }
  if (process.env.PRE_DEPLOY_HEAD_RESULT === 'failure') {
    return '❌ superseded before upload';
  }
  if (process.env.POST_DEPLOY_HEAD_RESULT === 'failure') {
    return '❌ superseded during upload';
  }
  if (process.env.ARTIFACT_ONLY === 'true') {
    return artifactStatus();
  }

  if (deployment === undefined || !deployment.ok) {
    return `❌ ${deployment?.error ?? 'application was not published'}`;
  }

  const appReport = report?.apps?.find(
    (candidate: VerificationSummary['apps'][number]) => candidate.appId === appId,
  );
  if (appReport?.ok === true) return '✅ verified';
  if (appReport !== undefined) {
    const reason = appReport.errors?.[0] ?? 'deployment was not verified against the source commit';
    return `❌ ${reason}`;
  }
  return '⚠️ uploaded, not verified';
}

function archivedArtifactMetadataPath(
  config: CloudflarePagesConfig,
  artifactDirectory: string | undefined,
): string | undefined {
  const metadataPath = config.artifact?.metadataPath;
  if (metadataPath === undefined || artifactDirectory === undefined) {
    return metadataPath;
  }

  const app = config.apps.find((candidate) => isPathWithin(candidate.directory, metadataPath));
  if (app === undefined) return metadataPath;
  return resolve(artifactDirectory, app.id, relative(app.directory, metadataPath));
}

async function runSummary(options: CliOptions): Promise<void> {
  const outputPath = option(options, 'output', process.env.GITHUB_STEP_SUMMARY);
  if (outputPath === undefined) throw new Error('output or GITHUB_STEP_SUMMARY is required');

  const plan = await readJsonIfPresent<DeploymentPlan>(option(options, 'planFile'), {
    shouldDeploy: 'unavailable',
    reason: 'plan unavailable',
    selectedApps: [],
    affectedTargets: [],
  });
  const configuredPath = option(options, 'config');
  const config: CloudflarePagesConfig =
    configuredPath === undefined
      ? {apps: [], environments: {}, forcePaths: []}
      : await readCloudflarePagesConfig(configuredPath);
  const deploymentManifest = await readJsonIfPresent<DeploymentManifest>(
    option(options, 'deploymentFile'),
    {
      apps: [],
    },
  );
  const verificationReport = await readJsonIfPresent<VerificationSummary | null>(
    option(options, 'verificationReport'),
    null,
  );
  const metadataPath =
    option(options, 'artifactMetadata') ??
    archivedArtifactMetadataPath(config, option(options, 'artifactDirectory'));
  const metadata = await readJsonIfPresent<Record<string, unknown> | null>(metadataPath, null);
  const buildLogPath = option(options, 'buildLog');
  const buildLog = await readFileIfPresent(buildLogPath);
  const turboLines = buildLog
    .split('\n')
    .filter((line) => turboSummaryLinePattern.test(line))
    .slice(-6);
  const platform = option(options, 'platform', 'Cloudflare Pages');
  const title = option(options, 'title', 'Deployment');
  const sourceCommit = process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? verificationReport?.commitSha;
  const deployments = deploymentManifest.apps;
  const artifactOnly = process.env.ARTIFACT_ONLY === 'true';
  const artifactReady =
    process.env.ARTIFACT_RESULT === 'success' && process.env.ARTIFACT_UPLOAD_RESULT === 'success';
  const supersededBeforeUpload = process.env.PRE_DEPLOY_HEAD_RESULT === 'failure';
  const supersededDuringUpload = process.env.POST_DEPLOY_HEAD_RESULT === 'failure';
  const syncMessage =
    plan.shouldDeploy !== true
      ? 'No deployment was selected by the affected-target plan; existing Pages URLs are not refreshed for this commit.'
      : supersededBeforeUpload
        ? 'A newer commit superseded this run before upload; no Pages deployment was published for this source commit.'
        : supersededDuringUpload
          ? 'A newer commit superseded this run during upload; the stale run did not register a GitHub deployment status.'
          : artifactOnly
            ? artifactReady
              ? 'A verified artifact was archived and uploaded; Pages publication is handled by the separate deployment job.'
              : `The verified artifact was not produced for this commit (archive: ${getMetric(process.env.ARTIFACT_RESULT)}, upload: ${getMetric(process.env.ARTIFACT_UPLOAD_RESULT)}).`
            : verificationReport?.ok === true
              ? 'Every selected app was checked and matched the exact source commit above.'
              : verificationReport !== null
                ? 'The deployment was attempted, but one or more Pages applications could not be verified against the exact source commit above.'
                : process.env.DEPLOYMENT_RESULT === 'success'
                  ? 'The artifact was uploaded, but Pages applications were not verified for this source commit.'
                  : 'The deployment did not complete, so Pages applications are not available for this commit.';
  const lines = [
    `## ${title} metrics`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Turbo affected plan | ${plan.shouldDeploy} (${plan.reason}) |`,
    `| Queue | ${getMetric(process.env.QUEUE_SECONDS)} seconds |`,
    `| Build and assembly | ${getMetric(process.env.BUILD_SECONDS)} seconds (${getMetric(process.env.BUILD_RESULT)}) |`,
    `| Configured validation | ${getMetric(process.env.VALIDATION_SECONDS)} seconds (${getMetric(process.env.VALIDATION_RESULT)}) |`,
    ...(artifactOnly
      ? [
          `| Verified artifact archive | ${getMetric(process.env.ARTIFACT_SECONDS)} seconds (${getMetric(process.env.ARTIFACT_RESULT)}) |`,
          `| Artifact upload | ${getMetric(process.env.ARTIFACT_UPLOAD_RESULT)} |`,
        ]
      : []),
    `| ${platform} upload | ${getMetric(process.env.DEPLOYMENT_SECONDS)} seconds (${getMetric(process.env.DEPLOYMENT_RESULT)}) |`,
    `| Deployment verification | ${getMetric(process.env.DEPLOYMENT_VERIFICATION_SECONDS)} seconds (${getMetric(process.env.DEPLOYMENT_VERIFICATION_RESULT)}) |`,
    '| Remote cache | Workflow-configured read and write policy |',
    `| Published apps | ${deployments.filter((deployment) => deployment.ok).length}/${config.apps.length} |`,
    '',
    '### Application deployments',
    '',
    `Source commit: ${sourceCommit === undefined ? '`unavailable`' : `\`${sourceCommit}\``}`,
    '',
    syncMessage,
    '',
    '| App | Status | Deployment | Source commit |',
    '| --- | --- | --- | --- |',
    ...config.apps.map((app) => {
      const deployment = deployments.find((candidate) => candidate.appId === app.id);
      const deploymentUrl =
        deployment?.url === undefined ? 'N/A' : `[open deployment](${deployment.url})`;
      const commit = sourceCommit === undefined ? 'N/A' : `\`${sourceCommit.slice(0, 12)}\``;
      return `| ${markdownCell(app.id)} | ${markdownCell(appStatus({plan, report: verificationReport, deployment, appId: app.id}))} | ${deploymentUrl} | ${commit} |`;
    }),
    ...(config.apps.length === 0 ? ['No apps are configured for this deployment.'] : []),
    '',
    '### Turbo cache output',
    '',
    '**Affected Pages targets**',
    ...plan.affectedTargets.map((target) => `- \`${target}\``),
    '',
    ...(turboLines.length > 0
      ? turboLines.map((line) => `- ${line}`)
      : ['Build did not produce a Turbo log.']),
    '',
    '### Verified artifact',
    '',
  ];

  if (metadata !== null) {
    lines.push('- Verified artifact metadata was produced.', '');
  } else {
    lines.push('No verified artifact metadata was produced.');
  }

  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function printHelp(): void {
  process.stdout.write(
    `shipfox-cloudflare-pages <command> [options]\n\nCommands:\n  plan       Select affected apps from Turbo and git\n  build-all  Build configured apps with environment-specific inputs\n  validate   Run the configured local artifact validation\n  archive-all Archive selected application outputs\n  deploy     Upload one static directory to Cloudflare Pages\n  deploy-all Upload configured apps to Cloudflare Pages\n  verify     Check one deployed root, metadata, and JSON endpoints\n  verify-all Check configured apps against their Pages URLs\n  github     Manage GitHub deployment lifecycle or queue timing\n  summary    Write Cloudflare Pages deployment metrics\n`,
  );
}

function main(): Promise<unknown> | undefined {
  const [command, action, ...arguments_] = process.argv.slice(2);
  if (command === undefined || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  const optionArguments =
    command === 'github'
      ? arguments_
      : [action, ...arguments_].filter((argument) => argument !== undefined);
  const options = parseOptions(optionArguments);

  if (command === 'plan') return runPlan(options);
  if (command === 'build-all') return runBuildApps(options);
  if (command === 'validate') return runValidate(options);
  if (command === 'archive-all') return runArchiveApps(options);
  if (command === 'deploy') return runDeploy(options);
  if (command === 'deploy-all') return runDeployApps(options);
  if (command === 'verify') return runVerify(options);
  if (command === 'verify-all') return runVerifyApps(options);
  if (command === 'github') {
    if (action === undefined) throw new Error('GitHub action is required');
    return runGitHub(action, options);
  }
  if (command === 'summary') return runSummary(options);
  throw new Error(`Unsupported Cloudflare Pages command: ${command}`);
}

Promise.resolve(main()).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
