#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, log} from '@shipfox/tool-utils';
import {setupContext} from './turbo.js';

const DEFAULT_PLATFORMS = 'linux/amd64,linux/arm64';
const WHITESPACE_PATTERN = /\s+/;

// Matches the :tag / @digest suffix of an image reference's final path segment.
const TAG_OR_DIGEST_SUFFIX = /[:@].*$/;

// Everything after the bin name; `--setup-context` is consumed here, the rest is
// forwarded verbatim to `docker buildx build` (tags, build-args, labels, ...).
const passthrough = process.argv.slice(2);

function hasFlag(...flags: string[]): boolean {
  return passthrough.some((arg) =>
    flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
  );
}

// True when the caller already passed `--build-arg NAME=...` (the value is its own
// token) or `--build-arg=NAME=...`, so a derived default never overrides it.
function hasBuildArg(name: string): boolean {
  return passthrough.some(
    (arg) => arg.startsWith(`${name}=`) || arg.startsWith(`--build-arg=${name}=`),
  );
}

function firstTag(): string | undefined {
  const index = passthrough.indexOf('--tag');
  if (index !== -1) return passthrough[index + 1];
  return passthrough.find((arg) => arg.startsWith('--tag='))?.slice('--tag='.length);
}

// Keep each app's gha cache separate so the three images built in one workflow
// run don't clobber each other. The scope is the image name (its last path
// segment), which is stable across registries: e.g. ghcr.io/org/api -> api.
function cacheScope(): string | undefined {
  const reference = firstTag() ?? process.env.npm_package_name;
  // Take the final path segment first, then drop the :tag / @digest suffix, so a
  // registry port (host:port/...) is never mistaken for the tag separator.
  return reference?.split('/').pop()?.replace(TAG_OR_DIGEST_SUFFIX, '');
}

// `--image <name>` (e.g. api) names the registry image for the derived tag set. It
// is consumed here, not forwarded, since it is not a `docker buildx build` flag.
// A missing value is rejected so a trailing `--image` never silently disables
// tagging, and `--image --push` never swallows the next flag as the name.
function takeImageName(): string | undefined {
  const inline = passthrough.findIndex((arg) => arg.startsWith('--image='));
  if (inline !== -1) {
    const value = passthrough.splice(inline, 1)[0]?.slice('--image='.length);
    if (!value) throw new Error('--image requires a non-empty value (e.g. --image api).');
    return value;
  }
  const flag = passthrough.indexOf('--image');
  if (flag !== -1) {
    const value = passthrough[flag + 1];
    if (!value || value.startsWith('-'))
      throw new Error('--image requires a value (e.g. --image api).');
    passthrough.splice(flag, 2);
    return value;
  }
  return undefined;
}

// Docker tag refs allow [A-Za-z0-9_.-]; the moving tag is a branch name, so map
// anything else to '-' (a slash in a feature branch would otherwise be rejected).
function sanitizeTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '-');
}

// The default branch's head is the newest build, so it takes Docker's conventional
// `latest` moving tag instead of a `main` tag.
const DEFAULT_BRANCH = 'main';

function movingTag(refName: string): string {
  return refName === DEFAULT_BRANCH ? 'latest' : sanitizeTag(refName);
}

// Registry bases for the derived tags: a space-separated IMAGE_REGISTRIES list read
// by name (not a prefix scan of the environment), so a stray credential variable is
// never mistaken for a registry base and logged. None set is the PR validation path.
function readRegistries(): string[] {
  return (process.env.IMAGE_REGISTRIES ?? '').split(WHITESPACE_PATTERN).filter(Boolean);
}

// Derive the per-commit tag set from the registry bases plus the GITHUB_SHA /
// BUILD_NUMBER / GITHUB_REF_NAME commit identity, so adding a registry is a config
// change, not a code change. With no registry (the PR validation path) emit a single
// local tag so a --load build has a reference. See the README for the full scheme.
function perCommitTags(image: string, registries: string[]): string[] {
  if (registries.length === 0) return [`${image}:ci`];

  const suffixes: string[] = [];
  const shortSha = process.env.GITHUB_SHA?.slice(0, 7);
  if (shortSha) suffixes.push(`sha-${shortSha}`);
  if (process.env.BUILD_NUMBER) suffixes.push(`build-${process.env.BUILD_NUMBER}`);
  if (process.env.GITHUB_REF_NAME) suffixes.push(movingTag(process.env.GITHUB_REF_NAME));
  if (suffixes.length === 0)
    throw new Error(
      'shipfox-docker --image needs GITHUB_SHA, BUILD_NUMBER, or GITHUB_REF_NAME set to derive a tag.',
    );

  return registries.flatMap((registry) =>
    suffixes.map((suffix) => `${registry}/${image}:${suffix}`),
  );
}

const setupIndex = passthrough.indexOf('--setup-context');
if (setupIndex !== -1) {
  const packageName = process.env.npm_package_name;
  if (!packageName)
    throw new Error(
      '--setup-context needs npm_package_name; run shipfox-docker through a package "image" script.',
    );
  setupContext(packageName);
  passthrough.splice(setupIndex, 1);
}

const imageName = takeImageName();
const registries = readRegistries();

// When --image is passed without registries, build one arch. Local validation
// still loads the image; CI PR validation only needs BuildKit to prove the
// Dockerfile builds, so it writes cache metadata without importing a tarball.
const validateOnly = imageName !== undefined && registries.length === 0;
const ciValidateOnly = validateOnly && process.env.GITHUB_ACTIONS === 'true';

const args: string[] = [];

// Drop provenance attestations so the pushed manifest stays a clean per-arch
// index without the "unknown/unknown" entries some registries show otherwise.
if (!hasFlag('--provenance')) args.push('--provenance=false');

// One buildx build emits the multi-arch manifest itself (QEMU covers both arches in
// one pass); the validate path stays single-arch since a multi-arch build can't load.
if (!hasFlag('--platform'))
  args.push('--platform', validateOnly ? 'linux/amd64' : DEFAULT_PLATFORMS);

// A multi-platform build cannot `--load`, so default to pushing; local validation
// loads its single-arch image, while CI validation avoids the tar export/import.
if (!hasFlag('--push', '--load', '--output', '-o')) {
  let outputFlag = '--push';
  if (ciValidateOnly) outputFlag = '--output=type=cacheonly';
  else if (validateOnly) outputFlag = '--load';
  args.push(outputFlag);
}

// Tags: an explicit --tag wins; otherwise derive the per-commit set from --image.
// CI cache-only validation has no image output for BuildKit to tag.
if (imageName && !ciValidateOnly && !hasFlag('--tag', '-t')) {
  for (const tag of perCommitTags(imageName, registries)) args.push('--tag', tag);
}

if (process.env.GITHUB_ACTIONS) {
  const scope = cacheScope();
  const scoped = scope ? [`scope=${scope}`] : [];
  args.push('--cache-from', ['type=gha', ...scoped].join(','));
  args.push('--cache-to', ['type=gha', 'mode=max', 'ignore-error=true', ...scoped].join(','));
}

if (process.env.NODE_VERSION) args.push(`--build-arg=NODE_VERSION=${process.env.NODE_VERSION}`);
if (process.env.PNPM_VERSION) args.push(`--build-arg=PNPM_VERSION=${process.env.PNPM_VERSION}`);

// OCI build metadata for the app images, set here from the environment rather than
// passed as turbo `--` args: anything after `--` enters the hash of every task in the
// run, so the run-unique IMAGE_CREATED timestamp would bust the build cache for the
// whole graph on every CI run.
if (imageName) {
  if (process.env.GITHUB_SHA && !hasBuildArg('IMAGE_REVISION'))
    args.push(`--build-arg=IMAGE_REVISION=${process.env.GITHUB_SHA}`);
  if (!hasBuildArg('IMAGE_CREATED'))
    args.push(`--build-arg=IMAGE_CREATED=${new Date().toISOString()}`);
  if (imageName === 'runner') {
    if (process.env.BUILD_NUMBER && !hasBuildArg('BUILD_NUMBER'))
      args.push(`--build-arg=BUILD_NUMBER=${process.env.BUILD_NUMBER}`);
    const runnerVersion = process.env.RUNNER_VERSION ?? process.env.BUILD_RUNNER_VERSION;
    if (runnerVersion && !hasBuildArg('RUNNER_VERSION'))
      args.push(`--build-arg=RUNNER_VERSION=${runnerVersion}`);
  }
}

const command = buildShellCommand(['docker', 'buildx', 'build', ...args, ...passthrough, '.']);
log.info(command);
execSync(command, {stdio: 'inherit'});
