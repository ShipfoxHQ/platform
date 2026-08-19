import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {
  DescribeImageAttributeCommand,
  type DescribeImageAttributeCommandOutput,
  DescribeImagesCommand,
  DescribeSnapshotsCommand,
  type DescribeSnapshotsCommandOutput,
  EC2Client,
  type Image,
  ModifyImageAttributeCommand,
} from '@aws-sdk/client-ec2';
import {getProjectRootPath, log} from '@shipfox/tool-utils';
import {AWS_ACCOUNT_ID_PATTERN, parseBuildRunnerImageArgs} from './build-runner-image.js';
import {buildRunnerImage, type RunnerImageBuild} from './runner-image.js';

const DEFAULT_CANDIDATE_TTL_DAYS = 14;
const DEFAULT_DESCRIBE_AVAILABILITY_RETRIES = 5;
const DEFAULT_DESCRIBE_AVAILABILITY_DELAY_MS = 2000;
const CANDIDATE_REGION = 'eu-central-1';
const FULL_SNAPSHOT_SIZE_LIMIT_PATTERN = /^full_snapshot_size_max_bytes=([1-9]\d*)$/mu;
const INVALID_AMI_NOT_FOUND = 'InvalidAMIID.NotFound';
const GIT_REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;

export interface RunnerImageCandidate {
  amiId: string;
  architecture: 'amd64' | 'arm64';
  candidateId: string;
  createdAt: string;
  expiresAt: string;
  imageOs: string;
  owner: string;
  region: string;
  revision: string;
  status: 'built' | 'reused';
}

interface CandidateImageMetadata {
  amiId: string;
  createdAt: string;
  expiresAt: string;
  owner: string;
}

interface Ec2ClientLike {
  send(command: DescribeImagesCommand): Promise<{Images?: Image[]}>;
  send(command: DescribeImageAttributeCommand): Promise<DescribeImageAttributeCommandOutput>;
  send(command: DescribeSnapshotsCommand): Promise<DescribeSnapshotsCommandOutput>;
  send(command: ModifyImageAttributeCommand): Promise<unknown>;
}

interface BuildRunnerImageCandidateOptions {
  build?: (build: RunnerImageBuild) => Promise<{amiId: string | null}>;
  client?: Ec2ClientLike;
  region?: string;
  describeAvailabilityRetries?: number;
  describeAvailabilityDelayMs?: number;
}

export async function buildRunnerImageCandidate(
  build: RunnerImageBuild,
  options: BuildRunnerImageCandidateOptions = {},
): Promise<RunnerImageCandidate> {
  if (build.lifecycle !== 'candidate' || !build.candidateId || !build.candidateExpiresAt) {
    throw new Error('Runner image candidate builds require candidate lifecycle metadata.');
  }
  const candidateId = build.candidateId;
  const region = candidateRegion(options.region);
  const client = options.client ?? new EC2Client({region});
  const existingImage = await findRunnerImageCandidate(
    client,
    build.revision,
    build.architecture,
    candidateId,
  );
  if (existingImage) {
    await reshareRunnerImageCandidate(client, existingImage.amiId, build);
    return candidateResult('reused', existingImage, build, candidateId, region);
  }

  const result = await (options.build ?? buildRunnerImage)(build);
  if (!result.amiId) throw new Error('Packer did not report a runner candidate AMI.');

  const builtImage = await describeBuiltCandidate(
    client,
    result.amiId,
    build,
    candidateId,
    options.describeAvailabilityRetries ?? DEFAULT_DESCRIBE_AVAILABILITY_RETRIES,
    options.describeAvailabilityDelayMs ?? DEFAULT_DESCRIBE_AVAILABILITY_DELAY_MS,
  );
  return candidateResult('built', builtImage, build, candidateId, region);
}

export function parseRunnerImageCandidateArgs(
  args: string[],
  env = process.env,
): {
  build: RunnerImageBuild;
  outputPath: string;
  region: string;
} {
  const {values, positionals} = parseArgs({
    args,
    strict: true,
    options: {output: {type: 'string'}},
  });
  if (positionals.length)
    throw new Error('build-runner-image-candidate does not accept arguments.');
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Runner image candidates can only be built and shared from main.');
  }
  const revision = required(env.BUILD_REVISION ?? env.GITHUB_SHA, 'BUILD_REVISION');
  if (!GIT_REVISION_PATTERN.test(revision)) {
    throw new Error('BUILD_REVISION must be a full lowercase Git revision.');
  }
  const ttlDays = candidateTtlDays(env.RUNNER_IMAGE_CANDIDATE_TTL_DAYS);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const build = parseBuildRunnerImageArgs(['ubuntu24', 'aws'], {
    ...env,
    BUILD_CANDIDATE_EXPIRES_AT: expiresAt,
    BUILD_CANDIDATE_ID: `main-${revision}`,
    BUILD_IMAGE_LIFECYCLE: 'candidate',
    BUILD_REVISION: revision,
  });

  return {
    build,
    outputPath: required(values.output, '--output'),
    region: candidateRegion(env.AWS_REGION),
  };
}

export function runRunnerImageCandidateCli(args = process.argv.slice(2)): void {
  void runRunnerImageCandidateCliAsync(args).catch((error: unknown) => {
    log.error(String(error));
    process.exitCode = 1;
  });
}

async function runRunnerImageCandidateCliAsync(args: string[]): Promise<void> {
  const {build, outputPath, region} = parseRunnerImageCandidateArgs(args);
  const candidate = await buildRunnerImageCandidate(build, {region});
  await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`);
  log.info(`Runner image candidate ${candidate.status}: ${candidate.region}:${candidate.amiId}`);
}

async function findRunnerImageCandidate(
  client: Ec2ClientLike,
  revision: string,
  architecture: 'amd64' | 'arm64',
  candidateId: string,
): Promise<CandidateImageMetadata | null> {
  const output = await client.send(
    new DescribeImagesCommand({
      Owners: ['self'],
      Filters: [
        {Name: 'tag:shipfox.managed', Values: ['true']},
        {Name: 'tag:shipfox.lifecycle', Values: ['candidate']},
        {Name: 'tag:shipfox.candidate_id', Values: [candidateId]},
        {Name: 'tag:shipfox.revision', Values: [revision]},
        {Name: 'tag:shipfox.architecture', Values: [architecture]},
      ],
    }),
  );
  const images = (output.Images ?? []).filter((image) => image.State === 'available');
  if (images.length > 1) {
    throw new Error(
      `Expected at most one ${architecture} candidate AMI for ${revision}, found: ${images
        .map((image) => image.ImageId ?? 'unknown')
        .join(', ')}.`,
    );
  }
  const image = images[0];
  return image ? candidateImageMetadata(image) : null;
}

async function describeBuiltCandidate(
  client: Ec2ClientLike,
  amiId: string,
  build: RunnerImageBuild,
  candidateId: string,
  availabilityRetries: number,
  availabilityDelayMs: number,
): Promise<CandidateImageMetadata> {
  const image = await describeAvailableImage(
    client,
    amiId,
    availabilityRetries,
    availabilityDelayMs,
  );
  const metadata = candidateImageMetadata(image);
  if (!image.Tags) {
    throw new Error(`Candidate AMI ${amiId} does not carry the expected build identity tags.`);
  }
  const tags = new Map(image.Tags.map((tag) => [tag.Key, tag.Value]));
  if (
    tags.get('shipfox.candidate_id') !== candidateId ||
    tags.get('shipfox.revision') !== build.revision ||
    tags.get('shipfox.architecture') !== build.architecture
  ) {
    throw new Error(`Candidate AMI ${amiId} does not carry the expected build identity tags.`);
  }
  await verifyRootSnapshotSize(client, image, build);
  return metadata;
}

async function verifyRootSnapshotSize(
  client: Ec2ClientLike,
  image: Image,
  build: RunnerImageBuild,
): Promise<void> {
  const amiId = required(image.ImageId, 'Candidate AMI ID');
  const rootSnapshotId = image.BlockDeviceMappings?.find(
    (mapping) => mapping.DeviceName === image.RootDeviceName,
  )?.Ebs?.SnapshotId;
  if (!rootSnapshotId) {
    throw new Error(`Candidate AMI ${amiId} has no root EBS snapshot to verify.`);
  }

  const output = await client.send(new DescribeSnapshotsCommand({SnapshotIds: [rootSnapshotId]}));
  const snapshot = output.Snapshots?.find((candidate) => candidate.SnapshotId === rootSnapshotId);
  const fullSnapshotSize = snapshot?.FullSnapshotSizeInBytes;
  if (fullSnapshotSize === undefined || !Number.isSafeInteger(fullSnapshotSize)) {
    throw new Error(
      `Candidate AMI ${amiId} root snapshot ${rootSnapshotId} has no valid full size.`,
    );
  }

  const ceiling = await readFullSnapshotSizeCeiling(build);
  if (fullSnapshotSize > ceiling) {
    throw new Error(
      `Candidate AMI ${amiId} root snapshot ${rootSnapshotId} is ${fullSnapshotSize} bytes, exceeding committed ceiling ${ceiling} bytes.`,
    );
  }
}

async function readFullSnapshotSizeCeiling(build: RunnerImageBuild): Promise<number> {
  const rootDir = getProjectRootPath(import.meta.url);
  const limitsPath = join(rootDir, 'composition', build.os, build.architecture, 'limits.env');
  const contents = await readFile(limitsPath, 'utf8');
  const value = contents.match(FULL_SNAPSHOT_SIZE_LIMIT_PATTERN)?.[1];
  const ceiling = value ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0) {
    throw new Error(`Runner image composition limit is invalid: ${limitsPath}`);
  }
  return ceiling;
}

// DescribeImages can briefly lag behind a Packer build that just registered the
// AMI. Retry with a bounded backoff instead of failing an otherwise-successful
// build on a single eventually-consistent read.
async function describeAvailableImage(
  client: Ec2ClientLike,
  amiId: string,
  retries: number,
  delayMs: number,
): Promise<Image> {
  for (let attempt = 0; ; attempt++) {
    let output: {Images?: Image[]};
    try {
      output = await client.send(new DescribeImagesCommand({Owners: ['self'], ImageIds: [amiId]}));
    } catch (error) {
      if (!isImageNotFoundError(error) || attempt >= retries) throw error;
      await sleep(delayMs);
      continue;
    }
    const image = output.Images?.find((candidate) => candidate.ImageId === amiId);
    if (image?.State === 'available') return image;
    if (attempt >= retries) {
      throw new Error(`Candidate AMI ${amiId} is not available after the Packer build.`);
    }
    await sleep(delayMs);
  }
}

async function reshareRunnerImageCandidate(
  client: Ec2ClientLike,
  amiId: string,
  build: RunnerImageBuild,
): Promise<void> {
  const consumerAccountIds = build.candidateConsumerAccountIds;
  if (!consumerAccountIds?.length) return;
  const permissions = await client.send(
    new DescribeImageAttributeCommand({ImageId: amiId, Attribute: 'launchPermission'}),
  );
  const stalePermissions = (permissions.LaunchPermissions ?? []).filter(
    (permission) => !permission.UserId || !consumerAccountIds.includes(permission.UserId),
  );
  await client.send(
    new ModifyImageAttributeCommand({
      ImageId: amiId,
      LaunchPermission: {
        Add: consumerAccountIds.map((accountId) => ({UserId: accountId})),
        ...(stalePermissions.length ? {Remove: stalePermissions} : {}),
      },
    }),
  );
}

function isImageNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const awsError = error as {code?: unknown; name?: unknown};
  return awsError.code === INVALID_AMI_NOT_FOUND || awsError.name === INVALID_AMI_NOT_FOUND;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function candidateResult(
  status: RunnerImageCandidate['status'],
  image: CandidateImageMetadata,
  build: RunnerImageBuild,
  candidateId: string,
  region: string,
): RunnerImageCandidate {
  return {
    status,
    amiId: image.amiId,
    architecture: build.architecture,
    candidateId,
    createdAt: image.createdAt,
    expiresAt: image.expiresAt,
    imageOs: build.os,
    owner: image.owner,
    region,
    revision: build.revision,
  };
}

function candidateImageMetadata(image: Image): CandidateImageMetadata {
  const amiId = required(image.ImageId, 'Candidate AMI ID');
  const owner = image.OwnerId;
  const createdAt = image.CreationDate;
  const expiresAt = image.Tags?.find((tag) => tag.Key === 'shipfox.expires_at')?.Value;
  if (!owner || !AWS_ACCOUNT_ID_PATTERN.test(owner)) {
    throw new Error(`Candidate AMI ${amiId} has no valid owner account.`);
  }
  return {
    amiId,
    createdAt: timestamp(createdAt, `Candidate AMI ${amiId} creation time`),
    expiresAt: timestamp(expiresAt, `Candidate AMI ${amiId} expiration time`),
    owner,
  };
}

function candidateTtlDays(value: string | undefined): number {
  if (!value) return DEFAULT_CANDIDATE_TTL_DAYS;
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new Error('RUNNER_IMAGE_CANDIDATE_TTL_DAYS must be a positive integer.');
  }
  return Number(value);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function candidateRegion(value: string | undefined): string {
  const region = value ?? CANDIDATE_REGION;
  if (region !== CANDIDATE_REGION) {
    throw new Error(`Runner image candidates must use ${CANDIDATE_REGION}.`);
  }
  return region;
}

function timestamp(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is missing.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid timestamp.`);
  return parsed.toISOString();
}
