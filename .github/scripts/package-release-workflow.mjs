import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function argumentValues(name) {
  const option = `--${name}`;
  return process.argv.flatMap((value, index) =>
    value === option && process.argv[index + 1] ? [process.argv[index + 1]] : [],
  );
}

function run(command, args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolveCommand({code, stderr, stdout}));
  });
}

async function writeOutput(values) {
  const outputPath = argument('github-output');
  if (!outputPath) return;
  await writeFile(
    outputPath,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    {flag: 'a'},
  );
}

async function writeSummary(summary) {
  const summaryPath = argument('github-summary');
  if (!summaryPath) return;
  await writeFile(summaryPath, `${summary}\n`, {flag: 'a'});
}

async function plan() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-release-plan-'));
  const outputPath = join(temporaryRoot, 'release-plan.json');
  try {
    const result = await run('pnpm', ['exec', 'changeset', 'status', '--output', outputPath]);
    const plan =
      result.code === 0 ? JSON.parse(await readFile(outputPath, 'utf8')) : {releases: []};
    const releases = Array.isArray(plan.releases) ? plan.releases : [];
    const hasChangesets = releases.length > 0;
    await writeOutput({has_changesets: String(hasChangesets)});
    await writeSummary(
      hasChangesets
        ? `## Package release plan\n\n${releases.map(({name, newVersion}) => `- \`${name}@${newVersion}\``).join('\n')}`
        : '## Package release PR\n\nNo unreleased changesets found; the release-PR updater is a no-op.',
    );
    process.stdout.write(`${JSON.stringify({hasChangesets, releases})}\n`);
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
  }
}

function releaseFromPullRequest(pullRequest, revision) {
  return {
    authorId: String(pullRequest.user?.id ?? ''),
    baseRevision: pullRequest.base?.sha ?? '',
    headRef: pullRequest.head?.ref ?? '',
    headRepository: pullRequest.head?.repo?.full_name ?? '',
    revision,
  };
}

function authorizationReason(release, repository, expectedAppId) {
  if (
    !release.revision ||
    !release.baseRevision ||
    !release.headRepository ||
    !release.headRef ||
    !release.authorId
  ) {
    return 'missing-release-metadata';
  }
  return releaseMetadataReason(release, repository, expectedAppId) ?? 'authorized';
}

function releaseMetadataReason(release, repository, expectedAppId) {
  if (release.headRepository !== repository) return 'head-repository-mismatch';
  if (release.headRef !== 'changeset-release/main') return 'release-branch-mismatch';
  if (release.authorId !== expectedAppId) return 'release-app-mismatch';
  return undefined;
}

async function resolveWorkflowDispatchRelease(eventName, repository, revision, fallback) {
  if (eventName !== 'workflow_dispatch' || !revision) return fallback;

  const result = await run('gh', ['api', `repos/${repository}/commits/${revision}/pulls`]);
  if (result.code !== 0) return fallback;
  const pullRequest = JSON.parse(result.stdout).find(
    (candidate) => candidate.merged_at !== null && candidate.merge_commit_sha === revision,
  );
  return pullRequest ? releaseFromPullRequest(pullRequest, revision) : fallback;
}

async function writeAuthorizationResult(release, reason) {
  const authorized = reason === 'authorized';
  await writeOutput({
    authorized: String(authorized),
    author_id: authorized ? release.authorId : '',
    base_sha: authorized ? release.baseRevision : '',
    head_ref: authorized ? release.headRef : '',
    head_repository: authorized ? release.headRepository : '',
    revision: authorized ? release.revision : '',
  });
  await writeSummary(
    `## Package publication authorization\n\n- Result: **${authorized ? 'authorized' : 'not authorized'}**\n- Reason: \`${reason}\``,
  );
  process.stdout.write(`${JSON.stringify({authorized, reason})}\n`);
}

async function authorize() {
  const eventName = argument('event-name');
  const repository = argument('repository');
  const expectedAppId = argument('release-app-id');
  const revision = argument('revision');
  const suppliedRelease = {
    authorId: argument('author-id') ?? '',
    baseRevision: argument('base') ?? '',
    headRef: argument('head-ref') ?? '',
    headRepository: argument('head-repository') ?? '',
    revision: revision ?? '',
  };

  if (eventName === 'pull_request' && argument('merged') !== 'true') {
    await writeOutput({authorized: 'false'});
    return;
  }
  const release = await resolveWorkflowDispatchRelease(
    eventName,
    repository,
    revision,
    suppliedRelease,
  );

  const reason = authorizationReason(release, repository, expectedAppId);
  await writeAuthorizationResult(release, reason);
}

function classificationResult(values, reason, message) {
  return {
    versionOnlyMain: values.versionOnlyMain ?? false,
    previousRevision: values.previousRevision ?? '',
    releasePrUrl: values.releasePrUrl ?? '',
    releasePrNumber: values.releasePrNumber ?? '',
    reason,
    message,
  };
}

async function writeMainClassification(result) {
  await writeOutput({
    version_only_main: String(result.versionOnlyMain),
    version_only_previous_revision: result.previousRevision,
    version_only_release_pr: result.releasePrUrl,
    version_only_release_pr_number: result.releasePrNumber,
    reason: result.reason,
  });
  await writeSummary(
    [
      '## Main commit classification',
      '',
      `- Result: **${result.versionOnlyMain ? 'version-only' : 'normal CI'}**`,
      `- Reason: \`${result.reason}\``,
      ...(result.releasePrUrl ? [`- Generated release PR: ${result.releasePrUrl}`] : []),
      ...(result.previousRevision
        ? [`- Prior candidate revision: \`${result.previousRevision}\``]
        : []),
      result.versionOnlyMain
        ? '- Application validation can use the fast path if prior image bytes are available.'
        : '- The workflow keeps the full main validation and build path.',
    ].join('\n'),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function resolvePreviousRevision(revision) {
  const parentResult = await run('git', ['rev-parse', `${revision}^1`]);
  if (parentResult.code !== 0) {
    return {
      error: classificationResult(
        {},
        'parent-revision-unavailable',
        'The parent revision could not be resolved; normal main CI remains required.',
      ),
    };
  }
  const previousRevision = parentResult.stdout.trim();
  if (!REVISION_PATTERN.test(previousRevision)) {
    return {
      error: classificationResult(
        {},
        'parent-revision-invalid',
        'The resolved parent is not a full Git revision; normal main CI remains required.',
      ),
    };
  }
  return {previousRevision};
}

async function resolveReleasePullRequest(repository, revision) {
  const result = await run('gh', [
    'api',
    `repos/${repository}/commits/${revision}/pulls`,
    '--header',
    'Accept: application/vnd.github+json',
  ]);
  if (result.code !== 0) {
    return {
      error: classificationResult(
        {},
        'merged-release-pr-unavailable',
        'The merged pull request could not be resolved; normal main CI remains required.',
      ),
    };
  }

  let pullRequests;
  try {
    pullRequests = JSON.parse(result.stdout);
  } catch {
    return {
      error: classificationResult(
        {},
        'merged-release-pr-invalid',
        'GitHub returned invalid pull request metadata; normal main CI remains required.',
      ),
    };
  }

  const releasePullRequest = Array.isArray(pullRequests)
    ? pullRequests.find(
        (pullRequest) =>
          typeof pullRequest.merged_at === 'string' &&
          pullRequest.merge_commit_sha === revision &&
          pullRequest.base?.ref === 'main',
      )
    : undefined;
  if (!releasePullRequest) {
    return {
      error: classificationResult(
        {},
        'merged-release-pr-not-found',
        'The commit is not the merged result of a pull request targeting main.',
      ),
    };
  }
  return {releasePullRequest};
}

async function verifyGeneratedRelease({
  authorId,
  expectedAppId,
  headRef,
  headRepository,
  previousRevision,
  repository,
  revision,
}) {
  const verifierResult = await run('pnpm', [
    '--silent',
    '--filter=@shipfox/package-release',
    'verify-generated-release',
    '--',
    '--base',
    previousRevision,
    '--head',
    revision,
    '--repository',
    repository,
    '--head-repository',
    headRepository,
    '--head-ref',
    headRef,
    '--author-id',
    authorId,
    '--release-app-id',
    expectedAppId,
  ]);
  const verifierLine = verifierResult.stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  let verifier;
  try {
    verifier = verifierLine ? JSON.parse(verifierLine) : undefined;
  } catch {
    verifier = undefined;
  }
  return {verifier, verified: verifierResult.code === 0};
}

async function classifyMain() {
  const revision = argument('revision');
  const repository = argument('repository');
  const expectedAppId = argument('release-app-id');
  const invalidMetadata = !revision || !repository || !expectedAppId;

  if (invalidMetadata) {
    await writeMainClassification(
      classificationResult(
        {},
        'missing-main-classification-metadata',
        'The main commit classifier did not receive the required metadata.',
      ),
    );
    return;
  }

  const previousRevisionResult = await resolvePreviousRevision(revision);
  if (previousRevisionResult.error) {
    await writeMainClassification(previousRevisionResult.error);
    return;
  }
  const previousRevision = previousRevisionResult.previousRevision;

  const releasePullRequestResult = await resolveReleasePullRequest(repository, revision);
  if (releasePullRequestResult.error) {
    await writeMainClassification(releasePullRequestResult.error);
    return;
  }
  const releasePullRequest = releasePullRequestResult.releasePullRequest;
  const releasePrUrl = releasePullRequest?.html_url ?? '';
  const releasePrNumber = releasePullRequest?.number ? String(releasePullRequest.number) : '';

  const headRepository = releasePullRequest.head?.repo?.full_name ?? '';
  const headRef = releasePullRequest.head?.ref ?? '';
  const authorId = String(releasePullRequest.user?.id ?? '');
  const metadataResult = releaseMetadataReason(
    {authorId, headRef, headRepository},
    repository,
    expectedAppId,
  );

  if (metadataResult) {
    await writeMainClassification(
      classificationResult(
        {releasePrUrl, releasePrNumber},
        metadataResult,
        'The merged pull request metadata is not an approved generated release.',
      ),
    );
    return;
  }

  const {verifier, verified} = await verifyGeneratedRelease({
    authorId,
    expectedAppId,
    headRef,
    headRepository,
    previousRevision,
    repository,
    revision,
  });
  const versionOnlyMain = verified && verifier?.classification === 'generated-release';
  await writeMainClassification(
    classificationResult(
      versionOnlyMain
        ? {versionOnlyMain: true, previousRevision, releasePrUrl, releasePrNumber}
        : {releasePrUrl, releasePrNumber},
      versionOnlyMain ? 'generated-tree-matches' : (verifier?.reason ?? 'verification-error'),
      versionOnlyMain
        ? 'The merged tree exactly matches the generated release output from its parent revision.'
        : 'The merged tree is not a deterministic generated release; normal main CI remains required.',
    ),
  );
}

async function verifyImageReuse() {
  const revision = argument('revision');
  const imageRepositories = [...new Set(argumentValues('image-repository'))];
  const references = imageRepositories.map(
    (repository) => `${repository}:revision-${revision ?? ''}`,
  );
  let unavailableReferences = [];
  let reason;

  if (!REVISION_PATTERN.test(revision ?? '')) {
    reason = 'prior-image-revision-invalid';
  } else if (imageRepositories.length === 0) {
    reason = 'application-image-repositories-missing';
  } else {
    const resolutions = await Promise.all(
      references.map(async (reference) => {
        const result = await run('oras', ['resolve', reference]);
        return {
          available: result.code === 0 && DIGEST_PATTERN.test(result.stdout.trim()),
          reference,
        };
      }),
    );
    unavailableReferences = resolutions
      .filter(({available}) => !available)
      .map(({reference}) => reference);
    reason =
      unavailableReferences.length === 0
        ? 'prior-application-images-available'
        : 'prior-application-images-unavailable';
  }

  const versionOnlyMain = reason === 'prior-application-images-available';
  await writeOutput({
    version_only_main: String(versionOnlyMain),
    reason,
  });
  await writeSummary(
    [
      '## Application image reuse classification',
      '',
      `- Result: **${versionOnlyMain ? 'version-only' : 'normal CI'}**`,
      `- Reason: \`${reason}\``,
      ...(revision ? [`- Prior revision: \`${revision}\``] : []),
      ...(unavailableReferences.length > 0
        ? [
            '- Unavailable image references:',
            ...unavailableReferences.map((reference) => `  - \`${reference}\``),
          ]
        : []),
      versionOnlyMain
        ? '- All prior image digests are available; image bytes can be reused.'
        : '- The current release commit will run full validation and build its images once.',
    ].join('\n'),
  );
  process.stdout.write(`${JSON.stringify({reason, unavailableReferences, versionOnlyMain})}\n`);
}

async function summarizeUpdate() {
  const before = JSON.parse(await readFile(argument('before'), 'utf8'));
  const after = JSON.parse(await readFile(argument('after'), 'utf8'));
  const beforeHead = before[0]?.headRefOid;
  const afterHead = after[0]?.headRefOid;
  let result = 'unchanged';
  if (!beforeHead && afterHead) result = 'created';
  else if (beforeHead !== afterHead) result = 'updated';
  const number = after[0]?.number;
  await writeSummary(
    [
      '## Package release PR',
      '',
      `- Trigger: \`${argument('trigger')}\``,
      `- Result: **${result}**`,
      ...(number ? [`- Release PR: #${number}`] : []),
      '- Publication authority: none',
      '- Batching: a newer `main` push cancels pending or running updater work; npm publication uses a separate non-cancelable workflow.',
    ].join('\n'),
  );
  process.stdout.write(`${JSON.stringify({number, result})}\n`);
}

async function summarizePublication() {
  await writeSummary(
    [
      '## npm package publication',
      '',
      `- Trigger: \`${argument('trigger')}\``,
      `- Revision: \`${argument('revision')}\``,
      '- Release tree: deterministically verified before publication.',
      '- Publication: completed; the publisher is serialized and never canceled.',
      '- Recovery: rerun this workflow with `workflow_dispatch` and the same exact merged revision. The closure publisher skips package versions already present in npm.',
    ].join('\n'),
  );
}

const command = process.argv[2];
if (command === 'plan') await plan();
else if (command === 'authorize') await authorize();
else if (command === 'classify-main') await classifyMain();
else if (command === 'verify-image-reuse') await verifyImageReuse();
else if (command === 'summarize-update') await summarizeUpdate();
else if (command === 'summarize-publication') await summarizePublication();
else throw new Error(`Unknown package release workflow command: ${command ?? '(missing)'}`);
