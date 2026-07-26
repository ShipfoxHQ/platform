import {appendFile, readFile, writeFile} from 'node:fs/promises';
import {deployPreview} from './deploy.js';
import {
  assertCurrentPreviewCommit,
  createGitHubDeployment,
  finishGitHubDeployment,
  getWorkflowQueueSeconds,
} from './github.js';
import {createPreviewPlan, readPreviewConfig} from './plan.js';
import {verifyPreview} from './verify.js';

const turboSummaryLinePattern = /^(Tasks:|Cached:|Time:)/;
const leadingSlashPattern = /^\/+/;
const indexJsonSuffixPattern = /\/index\.json$/;
const trailingSlashPattern = /\/$/;

function toOptionName(name) {
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function addOption(options, name, value) {
  if (options[name] === undefined) {
    options[name] = value;
    return;
  }
  options[name] = Array.isArray(options[name]) ? [...options[name], value] : [options[name], value];
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
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

function option(options, name, fallback) {
  return options[name] ?? fallback;
}

async function writeJson(path, value) {
  if (path === undefined) return;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeGitHubOutput(path, outputs) {
  if (path === undefined) return;
  const lines = Object.entries(outputs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${name}=${String(value).replaceAll('\n', ' ')}`);
  await appendFile(path, `${lines.join('\n')}\n`, 'utf8');
}

function configPath(options) {
  return option(options, 'config', 'preview-deploy.config.json');
}

async function runPlan(options) {
  const config = await readPreviewConfig(configPath(options));
  const plan = createPreviewPlan({
    targets: config.targets,
    forcePaths: config.forcePaths,
  });
  await writeJson(options.output, plan);
  await writeGitHubOutput(options.githubOutput, {
    should_deploy: plan.shouldDeploy,
    reason: plan.reason,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function runDeploy(options) {
  const startedAt = Date.now();
  const deployment = await deployPreview({
    provider: option(options, 'provider'),
    directory: option(options, 'directory'),
    project: option(options, 'project'),
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

async function runVerify(options) {
  const config = await readPreviewConfig(configPath(options));
  const startedAt = Date.now();
  const result = await verifyPreview({
    baseUrl: option(options, 'url'),
    expectedCommitSha: option(options, 'commit'),
    expectedPullRequest: option(options, 'pullRequest'),
    metadataPath: config.verify?.metadataPath ?? '/preview-metadata.json',
    endpoints: config.verify?.endpoints ?? [],
  });
  result.durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  await writeJson(options.output, result);
  await writeGitHubOutput(options.githubOutput, {
    verification_seconds: result.durationSeconds,
    verification_ok: result.ok,
  });
  process.stdout.write(
    `${result.ok ? 'Verified' : 'Verification failed'} ${result.url}: root, ${result.metadataPath}, and ${result.endpoints.length} endpoint(s)\n`,
  );
  if (!result.ok) throw new Error(result.errors.join('; '));
}

async function runGitHub(action, options) {
  if (action === 'assert-current') {
    const result = await assertCurrentPreviewCommit({
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
      ref: option(options, 'ref', process.env.PREVIEW_COMMIT_SHA ?? process.env.GITHUB_SHA),
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

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readJsonIfPresent(path, fallback) {
  if (path === undefined) return fallback;
  try {
    return await readJson(path);
  } catch {
    return fallback;
  }
}

async function readFileIfPresent(path) {
  if (path === undefined) return '';
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function getMetric(value) {
  return value === undefined || value === '' ? 'unavailable' : value;
}

function endpointDetails(endpoint) {
  return typeof endpoint === 'string'
    ? {id: endpoint, path: endpoint}
    : {id: endpoint.id ?? endpoint.path, path: endpoint.path};
}

function appPreviewUrl(deploymentUrl, endpointPath) {
  if (deploymentUrl === undefined || deploymentUrl === '' || deploymentUrl === 'unavailable') {
    return null;
  }
  const appPath = endpointPath.replace(leadingSlashPattern, '').replace(indexJsonSuffixPattern, '');
  const baseUrl = deploymentUrl.replace(trailingSlashPattern, '');
  return appPath.length === 0 ? `${baseUrl}/` : `${baseUrl}/${appPath}/`;
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function appStatus({plan, report, endpoint}) {
  if (plan.shouldDeploy !== true) return 'Not synced for this commit';
  if (process.env.PRE_DEPLOY_HEAD_RESULT === 'failure') {
    return '❌ superseded before upload';
  }
  if (process.env.POST_DEPLOY_HEAD_RESULT === 'failure') {
    return '❌ superseded during upload';
  }

  const endpointReport = report?.endpoints?.find(
    (candidate) => candidate.id === endpoint.id || candidate.path === endpoint.path,
  );
  if (report !== null && endpointReport !== undefined && !endpointReport.ok) {
    return `❌ ${endpointReport.error}`;
  }
  if (report?.ok === true && endpointReport?.ok === true) return '✅ verified';
  if (report !== null) {
    const reason = report.errors?.[0] ?? 'deployment was not verified against the source commit';
    return `❌ ${reason}`;
  }
  if (process.env.DEPLOYMENT_RESULT !== 'success') return 'Not published';
  return '⚠️ uploaded, not verified';
}

async function runSummary(options) {
  const outputPath = option(options, 'output', process.env.GITHUB_STEP_SUMMARY);
  if (outputPath === undefined) throw new Error('output or GITHUB_STEP_SUMMARY is required');

  const plan = await readJsonIfPresent(option(options, 'planFile'), {
    shouldDeploy: 'unavailable',
    reason: 'plan unavailable',
    affectedTargets: [],
  });
  const config = option(options, 'config')
    ? await readPreviewConfig(option(options, 'config'))
    : {verify: {endpoints: []}};
  const verificationReport = await readJsonIfPresent(option(options, 'verificationReport'), null);
  const metadataPath = option(options, 'artifactMetadata');
  const metadata = await readJsonIfPresent(metadataPath, null);
  const buildLogPath = option(options, 'buildLog');
  const buildLog = await readFileIfPresent(buildLogPath);
  const turboLines = buildLog
    .split('\n')
    .filter((line) => turboSummaryLinePattern.test(line))
    .slice(-6);
  const provider = option(options, 'provider', process.env.PREVIEW_PROVIDER ?? 'preview provider');
  const title = option(options, 'title', 'Static preview');
  const sourceCommit = process.env.PREVIEW_COMMIT_SHA ?? verificationReport?.commitSha;
  const deploymentUrl = process.env.DEPLOYMENT_URL;
  const endpoints = (config.verify?.endpoints ?? []).map(endpointDetails);
  const supersededBeforeUpload = process.env.PRE_DEPLOY_HEAD_RESULT === 'failure';
  const supersededDuringUpload = process.env.POST_DEPLOY_HEAD_RESULT === 'failure';
  const syncMessage =
    plan.shouldDeploy !== true
      ? 'No deployment was selected by the affected-target plan; existing preview URLs are not refreshed for this commit.'
      : supersededBeforeUpload
        ? 'A newer commit superseded this run before upload; no preview was published for this source commit.'
        : supersededDuringUpload
          ? 'A newer commit superseded this run during upload; the stale run did not register a GitHub deployment status.'
          : verificationReport?.ok === true
            ? 'Every configured app endpoint was checked and matched the exact source commit above.'
            : verificationReport !== null
              ? 'The deployment was attempted, but one or more app endpoints could not be verified against the exact source commit above.'
              : process.env.DEPLOYMENT_RESULT === 'success'
                ? 'The artifact was uploaded, but app endpoints were not verified for this source commit.'
                : 'The deployment did not complete, so app previews are not available for this commit.';
  const lines = [
    `## ${title} metrics`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Turbo affected plan | ${plan.shouldDeploy} (${plan.reason}) |`,
    `| Queue | ${getMetric(process.env.QUEUE_SECONDS)} seconds |`,
    `| Build and assembly | ${getMetric(process.env.BUILD_SECONDS)} seconds (${getMetric(process.env.BUILD_RESULT)}) |`,
    `| Validation and browser smoke | ${getMetric(process.env.VALIDATION_SECONDS)} seconds (${getMetric(process.env.VALIDATION_RESULT)}) |`,
    `| ${provider} upload | ${getMetric(process.env.DEPLOYMENT_SECONDS)} seconds (${getMetric(process.env.DEPLOYMENT_RESULT)}) |`,
    `| Deployment verification | ${getMetric(process.env.DEPLOYMENT_VERIFICATION_SECONDS)} seconds (${getMetric(process.env.DEPLOYMENT_VERIFICATION_RESULT)}) |`,
    '| Remote cache | Pull requests read only; main reads and writes |',
    `| Preview URL | ${getMetric(process.env.DEPLOYMENT_URL)} |`,
    '',
    '### App previews',
    '',
    `Source commit: ${sourceCommit === undefined ? '`unavailable`' : `\`${sourceCommit}\``}`,
    '',
    syncMessage,
    '',
    '| App | Status | Preview | Source commit |',
    '| --- | --- | --- | --- |',
    ...endpoints.map((endpoint) => {
      const url = appPreviewUrl(deploymentUrl, endpoint.path);
      const preview = url === null ? '—' : `[open preview](${url})`;
      const commit = sourceCommit === undefined ? '—' : `\`${sourceCommit.slice(0, 12)}\``;
      return `| ${markdownCell(endpoint.id)} | ${markdownCell(appStatus({plan, report: verificationReport, endpoint}))} | ${preview} | ${commit} |`;
    }),
    ...(endpoints.length === 0 ? ['No app endpoints are configured for this preview.'] : []),
    '',
    '### Turbo cache output',
    '',
    '**Affected preview targets**',
    ...plan.affectedTargets.map((target) => `- \`${target}\``),
    '',
    ...(turboLines.length > 0
      ? turboLines.map((line) => `- ${line}`)
      : ['Build did not produce a Turbo log.']),
    '',
    '### Verified artifact',
    '',
  ];

  if (metadata?.metrics !== undefined) {
    lines.push('| Preview part | Files | Bytes |', '| --- | ---: | ---: |');
    lines.push(
      `| Composition shell | ${metadata.metrics.shell.fileCount} | ${metadata.metrics.shell.bytes} |`,
      ...metadata.metrics.children.map(
        (child) => `| ${child.id} | ${child.fileCount} | ${child.bytes} |`,
      ),
      `| Total | ${metadata.metrics.total.fileCount} | ${metadata.metrics.total.bytes} |`,
      '',
      '- Static output and configured endpoint checks passed.',
    );
  } else {
    lines.push('No verified artifact metadata was produced.');
  }

  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function printHelp() {
  process.stdout.write(
    `shipfox-preview <command> [options]\n\nCommands:\n  plan       Select an affected preview from Turbo and git\n  deploy     Upload a static directory through a provider adapter\n  verify     Check a deployed root, metadata, and JSON endpoints\n  github     Manage GitHub deployment lifecycle or queue timing\n  summary    Write standard GitHub Actions preview metrics\n`,
  );
}

function main() {
  const [command, action, ...arguments_] = process.argv.slice(2);
  if (command === undefined || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  const options = parseOptions(
    command === 'github' ? arguments_ : [action, ...arguments_].filter(Boolean),
  );

  if (command === 'plan') return runPlan(options);
  if (command === 'deploy') return runDeploy(options);
  if (command === 'verify') return runVerify(options);
  if (command === 'github') return runGitHub(action, options);
  if (command === 'summary') return runSummary(options);
  throw new Error(`Unsupported preview command: ${command}`);
}

Promise.resolve(main()).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
