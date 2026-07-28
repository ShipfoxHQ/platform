import {pathToFileURL} from 'node:url';
import {log} from '@shipfox/tool-utils';
import {
  buildRunnerImage,
  type RunnerImageLifecycle,
  type RunnerImagePlatform,
  readMiseNodeVersion,
} from './runner-image.js';

export const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/u;

export function parseBuildRunnerImageArgs(args: string[], env = process.env, nodeVersion?: string) {
  const [os, platform, ...extraPackerArgs] = args;
  if (!os || !platform)
    throw new Error('Usage: build-runner-image <os> <aws|qemu> [packer options]');
  if (!['aws', 'qemu'].includes(platform)) throw new Error('Platform must be aws or qemu.');
  if (!env.BUILD_NUMBER) throw new Error('BUILD_NUMBER is not set.');
  if (!env.BUILD_ATTEMPT) throw new Error('BUILD_ATTEMPT is not set.');
  if (!env.BUILD_ARCH || !['amd64', 'arm64'].includes(env.BUILD_ARCH)) {
    throw new Error('BUILD_ARCH must be amd64 or arm64.');
  }
  const lifecycle = (env.BUILD_IMAGE_LIFECYCLE ?? 'release') as RunnerImageLifecycle;
  if (!['candidate', 'release'].includes(lifecycle)) {
    throw new Error('BUILD_IMAGE_LIFECYCLE must be candidate or release.');
  }
  const sharedBuild = {
    os,
    platform: platform as RunnerImagePlatform,
    architecture: env.BUILD_ARCH as 'amd64' | 'arm64',
    buildAttempt: env.BUILD_ATTEMPT,
    buildNumber: env.BUILD_NUMBER,
    lifecycle,
    nodeVersion: nodeVersion ?? readMiseNodeVersion(),
    revision: env.BUILD_REVISION ?? env.GITHUB_SHA ?? 'local',
    extraPackerArgs,
  };
  if (lifecycle === 'candidate') {
    const candidateMetadata =
      platform === 'aws'
        ? {
            candidateKmsKeyId: required(
              env.BUILD_CANDIDATE_KMS_KEY_ID ?? env.AWS_RUNNER_IMAGE_CANDIDATE_KMS_KEY_ID,
              'BUILD_CANDIDATE_KMS_KEY_ID',
            ),
            candidateConsumerAccountIds: parseCandidateConsumerAccountIds(
              env.BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS ??
                env.AWS_RUNNER_IMAGE_CANDIDATE_CONSUMER_ACCOUNT_IDS,
            ),
          }
        : {};
    return {
      ...sharedBuild,
      ...candidateMetadata,
      candidateExpiresAt: required(env.BUILD_CANDIDATE_EXPIRES_AT, 'BUILD_CANDIDATE_EXPIRES_AT'),
      candidateId: required(env.BUILD_CANDIDATE_ID, 'BUILD_CANDIDATE_ID'),
    };
  }

  return {
    ...sharedBuild,
    runnerVersion: required(env.BUILD_RUNNER_VERSION, 'BUILD_RUNNER_VERSION'),
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function parseCandidateConsumerAccountIds(value: string | undefined): string[] {
  const rawValues = required(value, 'BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS');
  let accountIds: unknown;
  try {
    accountIds = rawValues.trimStart().startsWith('[')
      ? JSON.parse(rawValues)
      : rawValues.split(',').map((accountId) => accountId.trim());
  } catch {
    throw new Error('BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS must be a CSV or JSON array.');
  }
  if (
    !Array.isArray(accountIds) ||
    accountIds.length === 0 ||
    accountIds.some(
      (accountId) => typeof accountId !== 'string' || !AWS_ACCOUNT_ID_PATTERN.test(accountId),
    )
  ) {
    throw new Error('BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS must contain 12-digit AWS account IDs.');
  }
  return [...new Set(accountIds)];
}

export function runBuildRunnerImageCli(args = process.argv.slice(2)): void {
  const build = parseBuildRunnerImageArgs(args);
  buildRunnerImage(build).then(
    ({amiId}) => {
      if (amiId) log.info(`Runner AMI build complete: ${amiId}`);
    },
    (error: unknown) => {
      log.error(String(error));
      process.exitCode = 1;
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBuildRunnerImageCli();
}
