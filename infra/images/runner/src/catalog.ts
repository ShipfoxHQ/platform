import {readFileSync, writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {Ajv2020, type ValidateFunction} from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import {readPackerAmiArtifact} from './aws.js';
import type {RunnerImageCandidate} from './candidate.js';

export const RUNNER_IMAGE_RELEASE_KIND = 'shipfox.runner-image-release';
export const RUNNER_IMAGE_RELEASE_API_VERSION = 'v1';
export const RUNNER_IMAGE_CANDIDATE_KIND = 'shipfox.runner-image-candidate';
export const RUNNER_IMAGE_CANDIDATE_API_VERSION = 'v1';
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;
const addFormats = addFormatsModule.default as unknown as (validator: Ajv2020) => void;

export interface RunnerImageReleaseImage {
  amiId: string;
  architecture: 'amd64' | 'arm64';
  buildNumber: string;
  createdAt: string;
  encrypted: boolean;
  imageOs: string;
  region: string;
  runnerVersion: string;
  sourceAmi: string | null;
}

export interface RunnerImageReleaseInput {
  sourceRepository: string;
  revision: string;
  build: {
    system: string;
    id: string;
    number: number;
    attempt: number;
    url: string;
    createdAt: string;
  };
  images: RunnerImageReleaseImage[];
}

export interface RunnerImageReleaseManifest {
  kind: typeof RUNNER_IMAGE_RELEASE_KIND;
  apiVersion: typeof RUNNER_IMAGE_RELEASE_API_VERSION;
  source: {
    repository: string;
    revision: string;
  };
  build: RunnerImageReleaseInput['build'];
  images: RunnerImageReleaseImage[];
}

export interface RunnerImageCandidateManifestInput {
  sourceRepository: string;
  revision: string;
  build: RunnerImageReleaseInput['build'];
  images: RunnerImageCandidate[];
}

export interface RunnerImageCandidateManifest {
  kind: typeof RUNNER_IMAGE_CANDIDATE_KIND;
  apiVersion: typeof RUNNER_IMAGE_CANDIDATE_API_VERSION;
  source: {
    repository: string;
    revision: string;
  };
  build: RunnerImageCandidateManifestInput['build'];
  images: Array<{
    amiId: string;
    architecture: 'amd64' | 'arm64';
    candidateId: string;
    createdAt: string;
    encrypted: true;
    expiresAt: string;
    imageOs: string;
    owner: string;
    region: string;
  }>;
}

const validateManifest = createManifestValidator();
const validateCandidateManifest = createCandidateManifestValidator();

export function createRunnerImageReleaseManifest(
  input: RunnerImageReleaseInput,
): RunnerImageReleaseManifest {
  const manifest: RunnerImageReleaseManifest = {
    kind: RUNNER_IMAGE_RELEASE_KIND,
    apiVersion: RUNNER_IMAGE_RELEASE_API_VERSION,
    source: {
      repository: input.sourceRepository,
      revision: input.revision,
    },
    build: {
      ...input.build,
      createdAt: timestamp(input.build.createdAt, 'Build creation time'),
    },
    images: input.images.map((image) => ({
      ...image,
      createdAt: timestamp(image.createdAt, `Image ${image.amiId} creation time`),
    })),
  };

  if (!validateManifest(manifest)) {
    throw new Error(`Invalid runner image release manifest: ${formatErrors(validateManifest)}`);
  }
  assertUniqueArchitectures(manifest.images);

  return manifest;
}

export function mergeRunnerImageReleaseManifests(
  manifests: readonly RunnerImageReleaseManifest[],
): RunnerImageReleaseManifest {
  const [first, ...rest] = manifests;
  if (!first) throw new Error('At least one runner image release manifest is required.');

  for (const manifest of rest) {
    if (
      manifest.source.repository !== first.source.repository ||
      manifest.source.revision !== first.source.revision
    ) {
      throw new Error('Runner image release fragments must describe the same source revision.');
    }
  }

  const images = manifests.flatMap((manifest) => manifest.images);
  assertUniqueArchitectures(images);
  const latestBuild = manifests.reduce((latest, manifest) =>
    latest.build.createdAt >= manifest.build.createdAt ? latest : manifest,
  ).build;

  return createRunnerImageReleaseManifest({
    sourceRepository: first.source.repository,
    revision: first.source.revision,
    build: latestBuild,
    images: [...images].sort((left, right) => left.architecture.localeCompare(right.architecture)),
  });
}

export function createRunnerImageCandidateManifest(
  input: RunnerImageCandidateManifestInput,
): RunnerImageCandidateManifest {
  if (
    input.images.some(
      (image) =>
        image.revision !== input.revision || image.candidateId !== `main-${input.revision}`,
    )
  ) {
    throw new Error('Runner image candidates must describe the same source revision.');
  }
  const manifest: RunnerImageCandidateManifest = {
    kind: RUNNER_IMAGE_CANDIDATE_KIND,
    apiVersion: RUNNER_IMAGE_CANDIDATE_API_VERSION,
    source: {
      repository: input.sourceRepository,
      revision: input.revision,
    },
    build: {
      ...input.build,
      createdAt: timestamp(input.build.createdAt, 'Build creation time'),
    },
    images: input.images
      .map((image) => ({
        amiId: image.amiId,
        architecture: image.architecture,
        candidateId: image.candidateId,
        createdAt: timestamp(image.createdAt, `Image ${image.amiId} creation time`),
        encrypted: true as const,
        expiresAt: timestamp(image.expiresAt, `Image ${image.amiId} expiration time`),
        imageOs: image.imageOs,
        owner: image.owner,
        region: image.region,
      }))
      .sort((left, right) => left.architecture.localeCompare(right.architecture)),
  };

  if (!validateCandidateManifest(manifest)) {
    throw new Error(
      `Invalid runner image candidate manifest: ${formatErrors(validateCandidateManifest)}`,
    );
  }
  assertUniqueArchitectures(manifest.images);
  return manifest;
}

export function mergeRunnerImageCandidateManifests(
  candidates: readonly RunnerImageCandidate[],
  input: Omit<RunnerImageCandidateManifestInput, 'images'>,
): RunnerImageCandidateManifest {
  if (!candidates.length) throw new Error('At least one runner image candidate is required.');
  if (candidates.some((candidate) => candidate.revision !== input.revision)) {
    throw new Error('Runner image candidates must describe the same source revision.');
  }
  return createRunnerImageCandidateManifest({...input, images: [...candidates]});
}

export function runRunnerImageCatalogCli(args = process.argv.slice(2)): void {
  const [command] = args;
  if (command === 'create') {
    createRunnerImageCatalog(args.slice(1));
    return;
  }
  if (command === 'merge') {
    mergeRunnerImageCatalog(args.slice(1));
    return;
  }
  if (command === 'merge-candidates') {
    mergeRunnerImageCandidateCatalog(args.slice(1));
    return;
  }
  throw new Error('Usage: runner-image-catalog <create|merge|merge-candidates> [options]');
}

function createRunnerImageCatalog(args: string[]): void {
  const {values, positionals} = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      'build-attempt': {type: 'string'},
      'build-created-at': {type: 'string'},
      'build-id': {type: 'string'},
      'build-number': {type: 'string'},
      'build-system': {type: 'string'},
      'build-url': {type: 'string'},
      output: {type: 'string'},
      'packer-manifest': {type: 'string'},
      revision: {type: 'string'},
      'source-ami': {type: 'string'},
      'source-repository': {type: 'string'},
    },
  });
  if (positionals.length)
    throw new Error('runner-image-catalog create does not accept positional arguments.');

  const artifact = readPackerAmiArtifact(required(values['packer-manifest'], '--packer-manifest'));
  const customData = artifact.customData;
  const revision = required(values.revision, '--revision');
  const buildAttempt = required(values['build-attempt'], '--build-attempt');
  const buildNumber = required(values['build-number'], '--build-number');
  if (customData.revision !== revision) {
    throw new Error('Packer manifest revision does not match --revision.');
  }
  if (customData.build_number !== buildNumber) {
    throw new Error('Packer manifest build_number does not match --build-number.');
  }
  if (customData.build_attempt !== buildAttempt) {
    throw new Error('Packer manifest build_attempt does not match --build-attempt.');
  }
  if (customData.encrypted !== 'true') {
    throw new Error('Packer manifest must attest that the AMI is encrypted.');
  }
  const manifest = createRunnerImageReleaseManifest({
    sourceRepository: required(values['source-repository'], '--source-repository'),
    revision,
    build: {
      system: required(values['build-system'], '--build-system'),
      id: required(values['build-id'], '--build-id'),
      number: positiveInteger(buildNumber),
      attempt: positiveInteger(buildAttempt),
      url: required(values['build-url'], '--build-url'),
      createdAt: required(values['build-created-at'], '--build-created-at'),
    },
    images: [
      {
        amiId: artifact.amiId,
        region: artifact.region,
        architecture: architecture(customData.architecture),
        imageOs: required(customData.image_os, 'Packer manifest custom_data.image_os'),
        runnerVersion: required(
          customData.runner_version,
          'Packer manifest custom_data.runner_version',
        ),
        buildNumber: required(customData.build_number, 'Packer manifest custom_data.build_number'),
        encrypted: true,
        sourceAmi: values['source-ami'] || null,
        createdAt: new Date(artifact.buildTime * 1000).toISOString(),
      },
    ],
  });

  writeManifest(required(values.output, '--output'), manifest);
}

function mergeRunnerImageCatalog(args: string[]): void {
  const {values, positionals} = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {output: {type: 'string'}},
  });
  if (!positionals.length)
    throw new Error('runner-image-catalog merge requires at least one fragment path.');

  const manifests = positionals.map((path) => readRunnerImageReleaseManifest(path));
  writeManifest(required(values.output, '--output'), mergeRunnerImageReleaseManifests(manifests));
}

function mergeRunnerImageCandidateCatalog(args: string[]): void {
  const {values, positionals} = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      candidate: {type: 'string', multiple: true},
      'build-attempt': {type: 'string'},
      'build-created-at': {type: 'string'},
      'build-id': {type: 'string'},
      'build-number': {type: 'string'},
      'build-system': {type: 'string'},
      'build-url': {type: 'string'},
      output: {type: 'string'},
      revision: {type: 'string'},
      'source-repository': {type: 'string'},
    },
  });
  if (positionals.length)
    throw new Error('runner-image-catalog merge-candidates does not accept positional arguments.');
  const candidatePaths = stringValues(values.candidate, '--candidate');
  if (candidatePaths.length < 2) {
    throw new Error('runner-image-catalog merge-candidates requires both architecture results.');
  }
  const candidates = candidatePaths.map(readRunnerImageCandidate);
  const buildNumber = required(values['build-number'], '--build-number');
  const buildAttempt = required(values['build-attempt'], '--build-attempt');
  const manifest = mergeRunnerImageCandidateManifests(candidates, {
    sourceRepository: required(values['source-repository'], '--source-repository'),
    revision: required(values.revision, '--revision'),
    build: {
      system: required(values['build-system'], '--build-system'),
      id: required(values['build-id'], '--build-id'),
      number: positiveInteger(buildNumber),
      attempt: positiveInteger(buildAttempt),
      url: required(values['build-url'], '--build-url'),
      createdAt: required(values['build-created-at'], '--build-created-at'),
    },
  });
  writeManifest(required(values.output, '--output'), manifest);
}

function readRunnerImageReleaseManifest(path: string): RunnerImageReleaseManifest {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!validateManifest(value)) {
    throw new Error(`Invalid runner image release manifest: ${formatErrors(validateManifest)}`);
  }
  return value as RunnerImageReleaseManifest;
}

function readRunnerImageCandidate(path: string): RunnerImageCandidate {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Runner image candidate ${path} must be an object.`);
  }
  const candidate = value as Partial<RunnerImageCandidate>;
  if (
    typeof candidate.amiId !== 'string' ||
    (candidate.architecture !== 'amd64' && candidate.architecture !== 'arm64') ||
    typeof candidate.candidateId !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    typeof candidate.imageOs !== 'string' ||
    typeof candidate.owner !== 'string' ||
    typeof candidate.region !== 'string' ||
    typeof candidate.revision !== 'string' ||
    (candidate.status !== 'built' && candidate.status !== 'reused')
  ) {
    throw new Error(`Runner image candidate ${path} is missing required metadata.`);
  }
  return candidate as RunnerImageCandidate;
}

function writeManifest(
  path: string,
  manifest: RunnerImageReleaseManifest | RunnerImageCandidateManifest,
): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function createManifestValidator(): ValidateFunction<RunnerImageReleaseManifest> {
  const schemaPath = new URL('../schema/runner-image-release.v1.schema.json', import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validator = new Ajv2020({allErrors: true, strict: true});
  addFormats(validator);
  return validator.compile<RunnerImageReleaseManifest>(schema);
}

function createCandidateManifestValidator(): ValidateFunction<RunnerImageCandidateManifest> {
  const schemaPath = new URL('../schema/runner-image-candidate.v1.schema.json', import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validator = new Ajv2020({allErrors: true, strict: true});
  addFormats(validator);
  return validator.compile<RunnerImageCandidateManifest>(schema);
}

function architecture(value: string | undefined): 'amd64' | 'arm64' {
  if (value === 'amd64' || value === 'arm64') return value;
  throw new Error('Packer manifest custom_data.architecture must be amd64 or arm64.');
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function positiveInteger(value: string): number {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new Error(`${JSON.stringify(value)} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${JSON.stringify(value)} must be a safe integer.`);
  return parsed;
}

function assertUniqueArchitectures(images: ReadonlyArray<{architecture: 'amd64' | 'arm64'}>): void {
  const architectures = new Set<string>();
  for (const image of images) {
    if (architectures.has(image.architecture)) {
      throw new Error(`Runner image release has duplicate ${image.architecture} artifacts.`);
    }
    architectures.add(image.architecture);
  }
}

function stringValues(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be provided at least twice.`);
  }
  return value as string[];
}

function timestamp(value: string, label: string): string {
  if (!UTC_TIMESTAMP_PATTERN.test(value))
    throw new Error(`${label} must be a valid UTC timestamp.`);
  const canonicalValue = value.includes('.') ? value : `${value.slice(0, -1)}.000Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== canonicalValue) {
    throw new Error(`${label} must be a valid UTC timestamp.`);
  }
  return canonicalValue;
}

function formatErrors(validator: ValidateFunction): string {
  return (
    validator.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ') ?? 'unknown schema error'
  );
}
