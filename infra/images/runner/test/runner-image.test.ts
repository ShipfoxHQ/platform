import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {findProducedAmiId, parsePackerAmiArtifact} from '#aws.js';
import {parseBuildRunnerImageArgs} from '#build-runner-image.js';
import {buildRunnerImageCandidate, parseRunnerImageCandidateArgs} from '#candidate.js';
import {packerBuildArgs, readMiseNodeVersion} from '#runner-image.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readMiseNodeVersion', () => {
  it('reads the selected Node version from mise', () => {
    const version = readMiseNodeVersion(() => '24.17.0\n');

    expect(version).toBe('24.17.0');
  });
});

describe('packerBuildArgs', () => {
  it('targets the AWS image source and passes the shared image variables', () => {
    const args = packerBuildArgs(
      {
        os: 'ubuntu24',
        platform: 'aws',
        architecture: 'amd64',
        buildAttempt: '1',
        buildNumber: '42',
        lifecycle: 'release',
        nodeVersion: '24.17.0',
        revision: '0123456789abcdef0123456789abcdef01234567',
        runnerVersion: '0.1.0',
        extraPackerArgs: [],
      },
      '/tmp/workspace',
    );

    expect(args).toEqual([
      'build',
      '-only',
      'runner.amazon-ebs.build_image',
      '-var',
      'image_os=ubuntu24',
      '-var',
      'architecture=amd64',
      '-var',
      'build_attempt=1',
      '-var',
      'build_number=42',
      '-var',
      'image_lifecycle=release',
      '-var',
      'node_version=24.17.0',
      '-var',
      'revision=0123456789abcdef0123456789abcdef01234567',
      '-var',
      'platform=aws',
      '-var',
      'runner_workspace=/tmp/workspace',
      '-var',
      'runner_version=0.1.0',
      '.',
    ]);
  });

  it('passes a checked custom QEMU source relative to the project root', () => {
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_IMAGE', 'test-images/ubuntu.raw');
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_CHECKSUM', 'sha256:abc123');

    const args = packerBuildArgs(
      {
        os: 'ubuntu24',
        platform: 'qemu',
        architecture: 'amd64',
        buildAttempt: '1',
        buildNumber: '42',
        lifecycle: 'release',
        nodeVersion: '24.17.0',
        revision: '0123456789abcdef0123456789abcdef01234567',
        runnerVersion: '0.1.0',
        extraPackerArgs: [],
      },
      '/tmp/workspace',
      '/repo',
    );

    expect(args).toContain('qemu_source_image=/repo/test-images/ubuntu.raw');
    expect(args).toContain('qemu_source_checksum=sha256:abc123');
  });

  it('passes candidate metadata without a release version', () => {
    const args = packerBuildArgs(
      {
        os: 'ubuntu24',
        platform: 'aws',
        architecture: 'arm64',
        buildAttempt: '1',
        buildNumber: '42',
        candidateExpiresAt: '2026-08-03T10:00:00Z',
        candidateId: 'main-0123456789abcdef0123456789abcdef01234567',
        candidateConsumerAccountIds: ['123456789012', '210987654321'],
        candidateKmsKeyId: 'alias/shipfox-runner-image-candidate',
        lifecycle: 'candidate',
        nodeVersion: '24.17.0',
        revision: '0123456789abcdef0123456789abcdef01234567',
        extraPackerArgs: [],
      },
      '/tmp/workspace',
    );

    expect(args).toContain('image_lifecycle=candidate');
    expect(args).toContain('candidate_id=main-0123456789abcdef0123456789abcdef01234567');
    expect(args).toContain('candidate_expires_at=2026-08-03T10:00:00Z');
    expect(args).toContain('candidate_kms_key_id=alias/shipfox-runner-image-candidate');
    expect(args).toContain('candidate_ami_users=["123456789012","210987654321"]');
    expect(args.some((arg) => arg.startsWith('runner_version='))).toBe(false);
  });

  it('requires a KMS key for candidate AWS builds', () => {
    expect(() =>
      packerBuildArgs(
        {
          os: 'ubuntu24',
          platform: 'aws',
          architecture: 'amd64',
          buildAttempt: '1',
          buildNumber: '42',
          candidateExpiresAt: '2026-08-03T10:00:00Z',
          candidateId: 'main-0123456789abcdef0123456789abcdef01234567',
          candidateConsumerAccountIds: ['123456789012'],
          lifecycle: 'candidate',
          nodeVersion: '24.17.0',
          revision: '0123456789abcdef0123456789abcdef01234567',
          extraPackerArgs: [],
        },
        '/tmp/workspace',
      ),
    ).toThrow('Candidate AWS builds require candidateKmsKeyId.');
  });

  it('requires consumer accounts for candidate AWS builds', () => {
    expect(() =>
      packerBuildArgs(
        {
          os: 'ubuntu24',
          platform: 'aws',
          architecture: 'amd64',
          buildAttempt: '1',
          buildNumber: '42',
          candidateExpiresAt: '2026-08-03T10:00:00Z',
          candidateId: 'main-0123456789abcdef0123456789abcdef01234567',
          candidateKmsKeyId: 'alias/shipfox-runner-image-candidate',
          lifecycle: 'candidate',
          nodeVersion: '24.17.0',
          revision: '0123456789abcdef0123456789abcdef01234567',
          extraPackerArgs: [],
        },
        '/tmp/workspace',
      ),
    ).toThrow('Candidate AWS builds require candidate consumer accounts.');
  });

  it('rejects an unchecked custom QEMU source', () => {
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_IMAGE', '/images/ubuntu.raw');
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_CHECKSUM', '');

    expect(() =>
      packerBuildArgs(
        {
          os: 'ubuntu24',
          platform: 'qemu',
          architecture: 'amd64',
          buildAttempt: '1',
          buildNumber: '42',
          lifecycle: 'release',
          nodeVersion: '24.17.0',
          revision: '0123456789abcdef0123456789abcdef01234567',
          runnerVersion: '0.1.0',
          extraPackerArgs: [],
        },
        '/tmp/workspace',
      ),
    ).toThrow('SHIPFOX_QEMU_SOURCE_CHECKSUM');
  });
});

describe('findProducedAmiId', () => {
  it('extracts the final AMI identifier from Packer output', () => {
    const amiId = findProducedAmiId(
      'Found Image ID: ami-0123abc456def7890\nAMIs were created: ami-0fedcba9876543210',
    );

    expect(amiId).toBe('ami-0fedcba9876543210');
  });

  it('does not mistake a shortened identifier for an AMI', () => {
    const amiId = findProducedAmiId('AMIs were created: ami-0123abc');

    expect(amiId).toBeNull();
  });
});

describe('parsePackerAmiArtifact', () => {
  it('reads the completed AWS artifact and its provenance from Packer manifest output', () => {
    const artifact = parsePackerAmiArtifact({
      last_run_uuid: 'run-123',
      builds: [
        {
          name: 'runner.build_image',
          builder_type: 'amazon-ebs',
          packer_run_uuid: 'run-123',
          build_time: 1_784_390_400,
          artifact_id: 'eu-central-1:ami-0123abc456def7890',
          custom_data: {
            architecture: 'amd64',
            build_attempt: '1',
            build_number: '42',
            image_os: 'ubuntu24',
            revision: '0123456789abcdef0123456789abcdef01234567',
            runner_version: '0.1.0',
          },
        },
      ],
    });

    expect(artifact).toEqual({
      amiId: 'ami-0123abc456def7890',
      region: 'eu-central-1',
      buildTime: 1_784_390_400,
      customData: {
        architecture: 'amd64',
        build_attempt: '1',
        build_number: '42',
        image_os: 'ubuntu24',
        revision: '0123456789abcdef0123456789abcdef01234567',
        runner_version: '0.1.0',
      },
    });
  });
});

describe('parseBuildRunnerImageArgs', () => {
  it('parses the build target and forwards Packer options', () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'qemu', '-var', 'qemu_accelerator=tcg'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_NUMBER: '42',
        BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
        BUILD_RUNNER_VERSION: '0.1.0',
      },
      '24.17.0',
    );

    expect(build).toEqual({
      os: 'ubuntu24',
      platform: 'qemu',
      architecture: 'amd64',
      buildAttempt: '1',
      buildNumber: '42',
      lifecycle: 'release',
      nodeVersion: '24.17.0',
      revision: '0123456789abcdef0123456789abcdef01234567',
      runnerVersion: '0.1.0',
      extraPackerArgs: ['-var', 'qemu_accelerator=tcg'],
    });
  });

  it('rejects missing required build metadata', () => {
    expect(() => parseBuildRunnerImageArgs(['ubuntu24', 'aws'], {}, '24.17.0')).toThrow(
      'BUILD_NUMBER is not set.',
    );
  });

  it('requires an explicit runner version', () => {
    expect(() =>
      parseBuildRunnerImageArgs(
        ['ubuntu24', 'aws'],
        {BUILD_ARCH: 'amd64', BUILD_ATTEMPT: '1', BUILD_NUMBER: '42'},
        '24.17.0',
      ),
    ).toThrow('BUILD_RUNNER_VERSION is not set.');
  });

  it('accepts candidate metadata without a release version', () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: 'main-0123456789abcdef0123456789abcdef01234567',
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
      },
      '24.17.0',
    );

    expect(build).toMatchObject({
      candidateExpiresAt: '2026-08-03T10:00:00Z',
      candidateId: 'main-0123456789abcdef0123456789abcdef01234567',
      lifecycle: 'candidate',
    });
    expect(build).not.toHaveProperty('runnerVersion');
  });

  it('accepts a JSON array of consumer account ids', () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: 'main-0123456789abcdef0123456789abcdef01234567',
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '["123456789012","123456789012","210987654321"]',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
      },
      '24.17.0',
    );

    expect(build).toMatchObject({
      candidateConsumerAccountIds: ['123456789012', '210987654321'],
    });
  });

  it('rejects malformed JSON consumer account ids', () => {
    expect(() =>
      parseBuildRunnerImageArgs(
        ['ubuntu24', 'aws'],
        {
          BUILD_ARCH: 'amd64',
          BUILD_ATTEMPT: '1',
          BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
          BUILD_CANDIDATE_ID: 'main-0123456789abcdef0123456789abcdef01234567',
          BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '[123456789012',
          BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
          BUILD_IMAGE_LIFECYCLE: 'candidate',
          BUILD_NUMBER: '42',
          BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
        },
        '24.17.0',
      ),
    ).toThrow('BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS must be a CSV or JSON array.');
  });

  it('rejects a non-array JSON value for consumer account ids', () => {
    expect(() =>
      parseBuildRunnerImageArgs(
        ['ubuntu24', 'aws'],
        {
          BUILD_ARCH: 'amd64',
          BUILD_ATTEMPT: '1',
          BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
          BUILD_CANDIDATE_ID: 'main-0123456789abcdef0123456789abcdef01234567',
          BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '{"account":"123456789012"}',
          BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
          BUILD_IMAGE_LIFECYCLE: 'candidate',
          BUILD_NUMBER: '42',
          BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
        },
        '24.17.0',
      ),
    ).toThrow('BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS must contain 12-digit AWS account IDs.');
  });

  it('rejects an empty consumer account id list', () => {
    expect(() =>
      parseBuildRunnerImageArgs(
        ['ubuntu24', 'aws'],
        {
          BUILD_ARCH: 'amd64',
          BUILD_ATTEMPT: '1',
          BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
          BUILD_CANDIDATE_ID: 'main-0123456789abcdef0123456789abcdef01234567',
          BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '[]',
          BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
          BUILD_IMAGE_LIFECYCLE: 'candidate',
          BUILD_NUMBER: '42',
          BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
        },
        '24.17.0',
      ),
    ).toThrow('BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS must contain 12-digit AWS account IDs.');
  });

  it('rejects a consumer account id that is not 12 digits', () => {
    expect(() =>
      parseBuildRunnerImageArgs(
        ['ubuntu24', 'aws'],
        {
          BUILD_ARCH: 'amd64',
          BUILD_ATTEMPT: '1',
          BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
          BUILD_CANDIDATE_ID: 'main-0123456789abcdef0123456789abcdef01234567',
          BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,not-an-account-id',
          BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
          BUILD_IMAGE_LIFECYCLE: 'candidate',
          BUILD_NUMBER: '42',
          BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
        },
        '24.17.0',
      ),
    ).toThrow('BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS must contain 12-digit AWS account IDs.');
  });
});

describe('runner image candidates', () => {
  const revision = '0123456789abcdef0123456789abcdef01234567';
  const availableImage = (amiId: string, architecture: 'amd64' | 'arm64') => ({
    ImageId: amiId,
    State: 'available' as const,
    OwnerId: '123456789012',
    CreationDate: '2026-07-19T10:15:00Z',
    Tags: [
      {Key: 'shipfox.candidate_id', Value: `main-${revision}`},
      {Key: 'shipfox.revision', Value: revision},
      {Key: 'shipfox.architecture', Value: architecture},
      {Key: 'shipfox.expires_at', Value: '2026-08-03T10:00:00Z'},
    ],
  });

  it('builds a candidate when no matching AMI exists', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi
      .fn()
      .mockResolvedValueOnce({Images: []})
      .mockResolvedValueOnce({
        Images: [availableImage('ami-0123abc456def7890', 'amd64')],
      });
    const buildImage = vi.fn().mockResolvedValue({amiId: 'ami-0123abc456def7890'});

    const candidate = await buildRunnerImageCandidate(build, {
      build: buildImage,
      client: {send},
    });

    expect(buildImage).toHaveBeenCalledWith(build);
    expect(candidate).toEqual({
      amiId: 'ami-0123abc456def7890',
      architecture: 'amd64',
      candidateId: `main-${revision}`,
      createdAt: '2026-07-19T10:15:00.000Z',
      expiresAt: '2026-08-03T10:00:00.000Z',
      imageOs: 'ubuntu24',
      owner: '123456789012',
      region: 'eu-central-1',
      revision,
      status: 'built',
    });
  });

  it('reuses the matching available candidate AMI', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'arm64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi
      .fn()
      .mockResolvedValueOnce({Images: [availableImage('ami-0fedcba9876543210', 'arm64')]})
      .mockResolvedValueOnce({
        LaunchPermissions: [
          {UserId: '123456789012'},
          {UserId: '999999999999'},
          {Group: 'all'},
          {OrganizationArn: 'arn:aws:organizations::123456789012:organization/o-example'},
          {OrganizationalUnitArn: 'arn:aws:organizations::123456789012:ou/o-example/ou-example'},
        ],
      });
    const buildImage = vi.fn();

    const candidate = await buildRunnerImageCandidate(build, {
      build: buildImage,
      client: {send},
    });

    expect(buildImage).not.toHaveBeenCalled();
    expect(candidate.status).toBe('reused');
    expect(candidate.amiId).toBe('ami-0fedcba9876543210');
    expect(candidate.createdAt).toBe('2026-07-19T10:15:00.000Z');
    expect(candidate.expiresAt).toBe('2026-08-03T10:00:00.000Z');
    expect(candidate.owner).toBe('123456789012');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          ImageId: 'ami-0fedcba9876543210',
          Attribute: 'launchPermission',
        },
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          ImageId: 'ami-0fedcba9876543210',
          LaunchPermission: {
            Add: [{UserId: '123456789012'}, {UserId: '210987654321'}],
            Remove: [
              {UserId: '999999999999'},
              {Group: 'all'},
              {OrganizationArn: 'arn:aws:organizations::123456789012:organization/o-example'},
              {
                OrganizationalUnitArn:
                  'arn:aws:organizations::123456789012:ou/o-example/ou-example',
              },
            ],
          },
        },
      }),
    );
  });

  it('rejects duplicate available candidate AMIs', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi.fn().mockResolvedValue({
      Images: [
        {ImageId: 'ami-0123abc456def7890', State: 'available'},
        {ImageId: 'ami-0fedcba9876543210', State: 'available'},
      ],
    });

    const candidate = buildRunnerImageCandidate(build, {client: {send}});

    await expect(candidate).rejects.toThrow('Expected at most one amd64 candidate AMI');
  });

  it('rejects a built AMI that is not available yet', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi
      .fn()
      .mockResolvedValueOnce({Images: []})
      .mockResolvedValueOnce({
        Images: [{...availableImage('ami-0123abc456def7890', 'amd64'), State: 'pending'}],
      });
    const buildImage = vi.fn().mockResolvedValue({amiId: 'ami-0123abc456def7890'});

    const candidate = buildRunnerImageCandidate(build, {
      build: buildImage,
      client: {send},
      describeAvailabilityRetries: 0,
    });

    await expect(candidate).rejects.toThrow('is not available after the Packer build');
  });

  it('retries the availability check until the built AMI becomes available', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi
      .fn()
      .mockResolvedValueOnce({Images: []})
      .mockResolvedValueOnce({
        Images: [{...availableImage('ami-0123abc456def7890', 'amd64'), State: 'pending'}],
      })
      .mockResolvedValueOnce({
        Images: [availableImage('ami-0123abc456def7890', 'amd64')],
      });
    const buildImage = vi.fn().mockResolvedValue({amiId: 'ami-0123abc456def7890'});

    const candidate = await buildRunnerImageCandidate(build, {
      build: buildImage,
      client: {send},
      describeAvailabilityRetries: 1,
      describeAvailabilityDelayMs: 1,
    });

    expect(candidate.status).toBe('built');
    expect(candidate.amiId).toBe('ami-0123abc456def7890');
  });

  it('retries a transient AMI-not-found response during availability checks', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const notFound = Object.assign(new Error('The image does not exist.'), {
      name: 'InvalidAMIID.NotFound',
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce({Images: []})
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({
        Images: [availableImage('ami-0123abc456def7890', 'amd64')],
      });
    const buildImage = vi.fn().mockResolvedValue({amiId: 'ami-0123abc456def7890'});

    const candidate = await buildRunnerImageCandidate(build, {
      build: buildImage,
      client: {send},
      describeAvailabilityRetries: 1,
      describeAvailabilityDelayMs: 1,
    });

    expect(candidate.status).toBe('built');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('rejects a built AMI whose tags do not match the requested build', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi
      .fn()
      .mockResolvedValueOnce({Images: []})
      .mockResolvedValueOnce({
        Images: [availableImage('ami-0123abc456def7890', 'arm64')],
      });
    const buildImage = vi.fn().mockResolvedValue({amiId: 'ami-0123abc456def7890'});

    const candidate = buildRunnerImageCandidate(build, {build: buildImage, client: {send}});

    await expect(candidate).rejects.toThrow('does not carry the expected build identity tags');
  });

  it('rejects a candidate AMI with no valid owner account', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'arm64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi.fn().mockResolvedValue({
      Images: [{...availableImage('ami-0fedcba9876543210', 'arm64'), OwnerId: undefined}],
    });

    const candidate = buildRunnerImageCandidate(build, {client: {send}});

    await expect(candidate).rejects.toThrow('has no valid owner account');
  });

  it('rejects a candidate AMI missing its expiry tag', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'arm64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const image = availableImage('ami-0fedcba9876543210', 'arm64');
    const send = vi.fn().mockResolvedValue({
      Images: [{...image, Tags: image.Tags.filter((tag) => tag.Key !== 'shipfox.expires_at')}],
    });

    const candidate = buildRunnerImageCandidate(build, {client: {send}});

    await expect(candidate).rejects.toThrow('expiration time is missing');
  });

  it('derives candidate metadata from the source revision and requires a result path', () => {
    const result = parseRunnerImageCandidateArgs(['--output', '/tmp/candidate.json'], {
      BUILD_ARCH: 'amd64',
      BUILD_ATTEMPT: '1',
      BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
      BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
      BUILD_NUMBER: '42',
      BUILD_REVISION: revision,
    });

    expect(result.build).toMatchObject({
      candidateId: `main-${revision}`,
      lifecycle: 'candidate',
      revision,
    });
    expect(result.outputPath).toBe('/tmp/candidate.json');
  });

  it('rejects candidate builds from non-main GitHub refs', () => {
    expect(() =>
      parseRunnerImageCandidateArgs(['--output', '/tmp/candidate.json'], {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/pull/1378/merge',
      }),
    ).toThrow('only be built and shared from main');
  });

  it('rejects candidate builds for unsupported AWS regions', () => {
    expect(() =>
      parseRunnerImageCandidateArgs(['--output', '/tmp/candidate.json'], {
        AWS_REGION: 'us-east-1',
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS: '123456789012,210987654321',
        BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      }),
    ).toThrow('Runner image candidates must use eu-central-1.');
  });
});

describe('spot watchdog runtime script', () => {
  const script = new URL('../scripts/runtime/spot-watchdog.sh', import.meta.url);

  it.each(['stop', 'terminate', 'hibernate'])('parses a spaced %s IMDS notice', (action) => {
    const result = execFileSync(
      'sh',
      [
        '-c',
        '. "$1"; spot_interruption_action "$2"',
        'sh',
        script.pathname,
        `{"action": "${action}"}`,
      ],
      {encoding: 'utf8', env: {...process.env, SHIPFOX_SPOT_WATCHDOG_LIBRARY: '1'}},
    );

    expect(result.trim()).toBe(action);
  });

  it('does not treat an unrelated IMDS document as an interruption', () => {
    const result = execFileSync(
      'sh',
      [
        '-c',
        '. "$1"; spot_interruption_action "$2"',
        'sh',
        script.pathname,
        '{"action": "reboot"}',
      ],
      {encoding: 'utf8', env: {...process.env, SHIPFOX_SPOT_WATCHDOG_LIBRARY: '1'}},
    );

    expect(result.trim()).toBe('reboot');
  });
});

function systemdSection(unit: string, section: string): string | undefined {
  return unit.match(new RegExp(`\\[${section}\\]\\n([\\s\\S]*?)(?=\\n\\[[^\\n]+\\]|$)`))?.[1];
}

function systemdDirective(unit: string, section: string, name: string): string | undefined {
  const sectionBody = systemdSection(unit, section);
  if (!sectionBody) return undefined;
  const line = sectionBody.split('\n').find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1);
}

describe('systemd boot activation', () => {
  const assets = new URL('../assets/', import.meta.url);

  function readUnit(name: string): Promise<string> {
    return readFile(new URL(name, assets), 'utf8');
  }

  it('starts the lifecycle target when the complete environment file appears', async () => {
    const pathUnit = await readUnit('shipfox-runner-env.path');
    const targetUnit = await readUnit('shipfox-runner.target');

    expect(systemdDirective(pathUnit, 'Unit', 'After')).toBe('network-online.target');
    expect(systemdDirective(pathUnit, 'Unit', 'Wants')).toBe('network-online.target');
    expect(systemdDirective(pathUnit, 'Path', 'PathExists')).toBe('/etc/shipfox/runner.env');
    expect(systemdDirective(pathUnit, 'Path', 'Unit')).toBe('shipfox-runner-env.service');
    expect(systemdDirective(pathUnit, 'Install', 'WantedBy')).toBe('multi-user.target');
    expect(pathUnit).not.toContain('cloud-config.service');
    expect(pathUnit).not.toContain('cloud-final.service');

    expect(systemdDirective(targetUnit, 'Unit', 'After')).toBe(
      'network-online.target shipfox-runner-env.service',
    );
    expect(systemdDirective(targetUnit, 'Unit', 'Wants')).toBe(
      'network-online.target shipfox-runner.service shipfox-max-lifetime.service',
    );
    expect(systemdDirective(targetUnit, 'Unit', 'Requires')).toBe('shipfox-runner-env.service');
  });

  it('keeps lifecycle units behind the fail-closed environment gate', async () => {
    const expectations = [
      {
        name: 'shipfox-runner.service',
        after: 'network-online.target time-sync.target shipfox-runner-env.service',
        wantedBy: undefined,
      },
      {
        name: 'shipfox-max-lifetime.service',
        after: 'network-online.target shipfox-runner-env.service',
        wantedBy: undefined,
      },
      {
        name: 'shipfox-spot-watchdog.service',
        after: 'network-online.target shipfox-runner.service shipfox-runner-env.service',
        wantedBy: 'shipfox-runner.target',
      },
    ] as const;

    for (const expectation of expectations) {
      const unit = await readUnit(expectation.name);

      expect(systemdDirective(unit, 'Unit', 'After'), expectation.name).toBe(expectation.after);
      expect(systemdDirective(unit, 'Unit', 'Wants'), expectation.name).toBe(
        'network-online.target',
      );
      expect(systemdDirective(unit, 'Unit', 'Requires'), expectation.name).toBe(
        'shipfox-runner-env.service',
      );
      expect(systemdDirective(unit, 'Install', 'WantedBy'), expectation.name).toBe(
        expectation.wantedBy,
      );
      expect(unit, expectation.name).not.toContain('cloud-config.service');
      expect(unit, expectation.name).not.toContain('cloud-final.service');
    }
  });

  it('keeps the environment gate as a persistent non-empty-file check', async () => {
    const unit = await readUnit('shipfox-runner-env.service');

    expect(systemdDirective(unit, 'Unit', 'After')).toBe('network-online.target');
    expect(systemdDirective(unit, 'Unit', 'Wants')).toBe(
      'network-online.target shipfox-runner.target',
    );
    expect(systemdDirective(unit, 'Service', 'Type')).toBe('oneshot');
    expect(systemdDirective(unit, 'Service', 'ExecStart')).toBe(
      '/usr/bin/test -s /etc/shipfox/runner.env',
    );
    expect(systemdDirective(unit, 'Service', 'RemainAfterExit')).toBe('yes');
    expect(systemdDirective(unit, 'Install', 'WantedBy')).toBeUndefined();
    expect(unit).not.toContain('cloud-config.service');
    expect(unit).not.toContain('cloud-final.service');
  });
});
