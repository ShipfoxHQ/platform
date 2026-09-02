import {execFileSync, spawnSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findProducedAmiId, parsePackerAmiArtifact} from '#aws.js';
import {parseBuildRunnerImageArgs} from '#build-runner-image.js';
import {buildRunnerImageCandidate, parseRunnerImageCandidateArgs} from '#candidate.js';
import {packerBuildArgs, readMiseNodeVersion} from '#runner-image.js';

const WHITESPACE_PATTERN = /\s+/u;
const DEDICATED_SYSTEMD_VERIFY_PROVISIONER_PATTERN =
  /provisioner "shell" \{\s+inline = \[\s+"sudo systemd-analyze verify multi-user\.target"\s+\]\s+only = \["amazon-ebs\.build_image"\]\s+\}/u;
const EPHEMERAL_BOOT_MASKED_UNITS = [
  'apt-daily.service',
  'apt-daily-upgrade.service',
  'apt-daily.timer',
  'apt-daily-upgrade.timer',
  'unattended-upgrades.service',
  'systemd-journal-flush.service',
  'lvm2-monitor.service',
  'multipathd.service',
  'multipathd.socket',
  'ufw.service',
  'plymouth-read-write.service',
  'plymouth-quit.service',
  'plymouth-quit-wait.service',
  'udisks2.service',
  'ModemManager.service',
  'apport.service',
  'sysstat.service',
  'e2scrub_reap.service',
  'hibinit-agent.service',
  'grub-common.service',
  'grub-initrd-fallback.service',
  'keyboard-setup.service',
  'console-setup.service',
  'cryptdisks-early.service',
  'cryptdisks.service',
  'hwclock.service',
  'setvtrgb.service',
  'getty@tty1.service',
  'motd-news.timer',
  'update-notifier-download.timer',
  'update-notifier-motd.timer',
  'fwupd-refresh.timer',
  'man-db.timer',
  'logrotate.timer',
  'e2scrub_all.timer',
  'fstrim.timer',
  'dpkg-db-backup.timer',
  'sysstat-collect.timer',
  'sysstat-summary.timer',
  'sudo.service',
  'x11-common.service',
] as const;

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

  it('keeps the workspace gate in the image-level service boundary', async () => {
    const unit = await readUnit('shipfox-runner.service');

    expect(unit).toContain(
      'After=network-online.target time-sync.target shipfox-runner-env.service',
    );
    expect(unit).toContain('Wants=network-online.target time-sync.target');
    expect(unit).toContain(
      'ExecStartPre=/opt/shipfox-runner/scripts/runtime/verify-workspace-mount.sh',
    );
    expect(unit).not.toContain('RequiresMountsFor=');
    expect(systemdDirective(unit, 'Service', 'ExecStart')).toBe(
      '/opt/shipfox-runner/scripts/runtime/run-runner.sh /usr/local/bin/node dist/index.js',
    );
    expect(systemdDirective(unit, 'Unit', 'SuccessAction')).toBe('poweroff-immediate');
    expect(systemdDirective(unit, 'Unit', 'FailureAction')).toBe('poweroff-immediate');
    expect(systemdDirective(unit, 'Service', 'StandardOutput')).toBe('journal+console');
    expect(unit).toContain('Environment=SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT=true');
    expect(unit).not.toContain('--enable-source-maps');
  });

  it('forwards only the marked boot timeline to the EC2 console', async () => {
    const unit = await readUnit('shipfox-runner.service');
    const script = new URL('../scripts/runtime/run-runner.sh', import.meta.url);
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');
    const source = await readFile(script, 'utf8');

    execFileSync('/bin/sh', ['-n', script.pathname], {stdio: 'pipe'});

    const result = spawnSync(
      '/bin/bash',
      [
        script.pathname,
        process.execPath,
        '-e',
        [
          "process.stdout.write('ordinary stdout\\n');",
          "process.stderr.write('ordinary stderr\\n');",
          'require(\'node:fs\').writeSync(Number(process.env.SHIPFOX_BOOT_CONSOLE_FD), \'{"console_marker":"runner_boot_timeline"}\\n\');',
          'process.exitCode = 7;',
        ].join(''),
      ],
      {encoding: 'utf8'},
    );

    expect(result.status).toBe(7);
    expect(result.stdout).toBe('{"console_marker":"runner_boot_timeline"}\n');
    expect(result.stderr).toContain('ordinary stdout');
    expect(result.stderr).toContain('ordinary stderr');
    expect(source).toContain('SHIPFOX_BOOT_CONSOLE_FD=3');
    expect(source).toContain('exec "$@" 1>&2');
    expect(build).toContain('run-runner.sh /opt/shipfox-runner/scripts/runtime/run-runner.sh');
    expect(unit).toContain('StandardError=journal');
  });

  it('ships the provider-gated workspace preflight separately from the runner app', async () => {
    const script = new URL('../scripts/runtime/verify-workspace-mount.sh', import.meta.url);
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');
    const source = await readFile(script, 'utf8');

    execFileSync('sh', ['-n', script.pathname], {stdio: 'pipe'});

    expect(() =>
      execFileSync('sh', [script.pathname], {
        env: {...process.env, SHIPFOX_RUNNER_PROVIDER_KIND: 'qemu'},
        stdio: 'pipe',
      }),
    ).not.toThrow();
    expect(() =>
      execFileSync('sh', [script.pathname], {
        env: {
          ...process.env,
          SHIPFOX_RUNNER_PROVIDER_KIND: 'ec2',
          SHIPFOX_RUNNER_WORKSPACE_ROOT: '/tmp/shipfox-workspace-not-mounted',
        },
        stdio: 'pipe',
      }),
    ).toThrow();

    expect(source).toContain('SHIPFOX_RUNNER_PROVIDER_KIND');
    expect(source).toContain(
      `workspace_root="\${SHIPFOX_RUNNER_WORKSPACE_ROOT:-/var/lib/shipfox/workspaces}"`,
    );
    expect(source).toContain('exec mountpoint -q "$workspace_root"');
    expect(source).toContain('the runner application only receives a usable workspace directory');
    expect(build).toContain(
      'verify-workspace-mount.sh /opt/shipfox-runner/scripts/runtime/verify-workspace-mount.sh',
    );
    expect(build).not.toContain('var-lib-shipfox-workspaces.mount');
  });

  it('watches for the complete environment without blocking basic boot on network readiness', async () => {
    const pathUnit = await readUnit('shipfox-runner-env.path');
    const targetUnit = await readUnit('shipfox-runner.target');

    expect(systemdDirective(pathUnit, 'Unit', 'After')).toBeUndefined();
    expect(systemdDirective(pathUnit, 'Unit', 'Wants')).toBeUndefined();
    expect(systemdDirective(pathUnit, 'Path', 'PathExists')).toBe('/etc/shipfox/runner.env');
    expect(systemdDirective(pathUnit, 'Path', 'Unit')).toBe('shipfox-runner-env.service');
    expect(systemdDirective(pathUnit, 'Install', 'WantedBy')).toBe('multi-user.target');
    expect(pathUnit).not.toContain('cloud-config.service');
    expect(pathUnit).not.toContain('cloud-final.service');

    expect(systemdDirective(targetUnit, 'Unit', 'After')).toBe(
      'network-online.target shipfox-runner-env.service',
    );
    expect(systemdDirective(targetUnit, 'Unit', 'Wants')).toBe(
      'network-online.target shipfox-runner.service',
    );
    expect(systemdDirective(targetUnit, 'Unit', 'Requires')).toBe('shipfox-runner-env.service');
  });

  it('accepts the legacy lifetime key without shipping an age timer', async () => {
    const targetUnit = await readUnit('shipfox-runner.target');
    const bootstrap = await readFile(
      new URL('../scripts/runtime/shipfox-bootstrap.sh', import.meta.url),
      'utf8',
    );
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-runner-legacy-env-'));

    try {
      await expect(
        readFile(new URL('../assets/shipfox-max-lifetime.service', import.meta.url), 'utf8'),
      ).rejects.toMatchObject({code: 'ENOENT'});
      await expect(
        readFile(new URL('../scripts/runtime/start-max-lifetime.sh', import.meta.url), 'utf8'),
      ).rejects.toMatchObject({code: 'ENOENT'});

      const legacyEnvironmentPath = join(fixtureRoot, 'runner.env');
      await writeFile(
        legacyEnvironmentPath,
        [
          'SHIPFOX_API_URL="https://api.shipfox.io"',
          'SHIPFOX_RUNNER_BOOTSTRAP_TOKEN="bootstrap-token"',
          'SHIPFOX_RUNNER_PROVIDER_KIND="ec2"',
          'SHIPFOX_RUNNER_PROTOCOL_VERSION="1"',
          'SHIPFOX_RUNNER_LABELS="linux"',
          'SHIPFOX_RUNNER_WORKSPACE_ROOT="/var/lib/shipfox/workspaces"',
          'SHIPFOX_POLL_MAX_DURATION_MS="300000"',
          'SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS="3600"',
          '',
        ].join('\n'),
      );
      const validateStart = bootstrap.indexOf('validate_runner_env() {');
      const validateEnd = bootstrap.indexOf('\nfetch_user_data() {', validateStart);
      expect(validateStart).toBeGreaterThanOrEqual(0);
      expect(validateEnd).toBeGreaterThan(validateStart);
      expect(() =>
        execFileSync(
          '/bin/sh',
          [
            '-c',
            `set -eu\n${bootstrap.slice(validateStart, validateEnd)}\nvalidate_runner_env "$1"`,
            'sh',
            legacyEnvironmentPath,
          ],
          {stdio: 'pipe'},
        ),
      ).not.toThrow();

      expect(bootstrap).toContain('SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS');
      expect(bootstrap).not.toContain('RUNNER_PREFERRED_RETIREMENT_AGE_SECONDS');
      expect(targetUnit).not.toContain('shipfox-max-lifetime.service');
      expect(build).not.toContain('shipfox-max-lifetime.service');
      expect(build).not.toContain('start-max-lifetime.sh');
      expect(readme).toContain('does not schedule an age-based poweroff');
      expect(readme).not.toContain('RUNNER_PREFERRED_RETIREMENT_AGE_SECONDS');
    } finally {
      await rm(fixtureRoot, {force: true, recursive: true});
    }
  });

  it('keeps lifecycle units behind the fail-closed environment gate', async () => {
    const expectations = [
      {
        name: 'shipfox-runner.service',
        after:
          'network-online.target time-sync.target shipfox-runner-env.service shipfox-runner-boot-complete.service',
        wants: 'network-online.target time-sync.target',
        wantedBy: undefined,
        requires: 'shipfox-runner-env.service shipfox-runner-boot-complete.service',
      },
      {
        name: 'shipfox-spot-watchdog.service',
        after: 'network-online.target shipfox-runner.service shipfox-runner-env.service',
        wants: 'network-online.target',
        wantedBy: 'shipfox-runner.target',
        requires: 'shipfox-runner-env.service',
      },
    ] as const;

    for (const expectation of expectations) {
      const unit = await readUnit(expectation.name);

      expect(systemdDirective(unit, 'Unit', 'After'), expectation.name).toBe(expectation.after);
      expect(systemdDirective(unit, 'Unit', 'Wants'), expectation.name).toBe(expectation.wants);
      expect(systemdDirective(unit, 'Unit', 'Requires'), expectation.name).toBe(
        expectation.requires,
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

    expect(systemdDirective(unit, 'Unit', 'After')).toBe(
      'network-online.target shipfox-bootstrap.service',
    );
    expect(systemdDirective(unit, 'Unit', 'Wants')).toBe(
      'network-online.target shipfox-runner.target',
    );
    expect(systemdDirective(unit, 'Service', 'Type')).toBe('oneshot');
    expect(systemdDirective(unit, 'Service', 'ExecStartPre')).toBe(
      "/bin/sh -c '/usr/bin/timeout 5s /opt/shipfox-runner/scripts/runtime/record-boot-io.sh || true'",
    );
    expect(systemdDirective(unit, 'Service', 'StandardOutput')).toBe('journal+console');
    expect(systemdDirective(unit, 'Service', 'ExecStart')).toBe(
      '/usr/bin/test -s /etc/shipfox/runner.env',
    );
    expect(systemdDirective(unit, 'Service', 'RemainAfterExit')).toBe('yes');
    expect(systemdDirective(unit, 'Install', 'WantedBy')).toBeUndefined();
    expect(unit).not.toContain('cloud-config.service');
    expect(unit).not.toContain('cloud-final.service');
  });

  it('fetches and publishes EC2 user data before the environment gate', async () => {
    const bootstrapUnit = await readUnit('shipfox-bootstrap.service');
    const script = new URL('../scripts/runtime/shipfox-bootstrap.sh', import.meta.url);
    const resolver = new URL(
      '../scripts/runtime/helpers/resolve-root-partition.sh',
      import.meta.url,
    );
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');
    const source = await readFile(script, 'utf8');
    const resolverSource = await readFile(resolver, 'utf8');

    execFileSync('sh', ['-n', script.pathname], {stdio: 'pipe'});
    execFileSync('sh', ['-n', resolver.pathname], {stdio: 'pipe'});

    expect(systemdDirective(bootstrapUnit, 'Unit', 'After')).toBe('network.target');
    expect(systemdDirective(bootstrapUnit, 'Unit', 'Wants')).toBe('network.target');
    expect(systemdDirective(bootstrapUnit, 'Unit', 'FailureAction')).toBe('poweroff');
    expect(systemdDirective(bootstrapUnit, 'Unit', 'Before')).toBe('shipfox-runner-env.service');
    expect(systemdDirective(bootstrapUnit, 'Service', 'Type')).toBe('oneshot');
    expect(systemdDirective(bootstrapUnit, 'Service', 'TimeoutStartSec')).toBe('6min');
    expect(systemdDirective(bootstrapUnit, 'Service', 'ExecStart')).toBe(
      '/opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh',
    );
    expect(systemdDirective(bootstrapUnit, 'Install', 'WantedBy')).toBe('multi-user.target');
    expect(source).toContain('X-aws-ec2-metadata-token-ttl-seconds: 21600');
    expect(source).toContain('SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS');
    expect(source).not.toContain('RUNNER_PREFERRED_RETIREMENT_AGE_SECONDS');
    expect(source).toContain('--request PUT');
    expect(source).toContain('/latest/user-data');
    expect(source).toContain("awk '{print int($1)}' /proc/uptime");
    expect(source).toContain('while [ "$(uptime_seconds)" -lt "$deadline" ]');
    expect(source).not.toContain('date +%s');
    expect(source).toContain('root_readahead_sectors="$' + '{SHIPFOX_ROOT_READAHEAD_SECTORS:-}"');
    expect(source).toContain('configure_root_readahead() {');
    expect(source).toContain('blockdev --getra "$root_source"');
    expect(source).toContain('blockdev --setra "$root_readahead_sectors" "$root_source"');
    expect(source).toContain('phase=readahead status=skipped');
    expect(source).toContain('reason=invalid-target');
    expect(source).toContain('root_readahead_after" != "$root_readahead_sectors"');
    expect(source).toContain('reason=clamped');
    expect(source).toContain(
      "printf 'shipfox-boot phase=readahead status=ok uptime=%s root_source=%s before_sectors=%s target_sectors=%s after_sectors=%s\\n' \\",
    );
    expect(source).toContain(
      "printf 'shipfox-boot phase=readahead status=fail uptime=%s root_source=%s before_sectors=%s target_sectors=%s after_sectors=%s reason=clamped\\n' \\",
    );
    const readaheadCallIndex = source.indexOf('\n  configure_root_readahead\n');
    const sshKeygenIndex = source.indexOf('\n  if ! /usr/bin/ssh-keygen -A;');
    expect(readaheadCallIndex).toBeGreaterThanOrEqual(0);
    expect(readaheadCallIndex).toBeLessThan(sshKeygenIndex);
    for (const phase of [
      'imds-token',
      'imds-userdata',
      'validate-env',
      'root-grow',
      'workspace-mount',
      'env-published',
    ]) {
      expect(source).toContain(phase);
    }
    expect(source).toContain("boot_phase='ssh-keygen'");
    let previousSuccessMarkerIndex = -1;
    for (const marker of [
      "emit_boot_phase 'imds-token' ok",
      "emit_boot_phase 'imds-userdata' ok",
      "emit_boot_phase 'validate-env' ok",
      "emit_boot_phase 'root-grow' ok",
      "emit_boot_phase 'workspace-mount' ok",
      "emit_boot_phase 'env-published' ok",
    ]) {
      const successMarkerIndex = source.indexOf(marker);

      expect(successMarkerIndex).toBeGreaterThan(previousSuccessMarkerIndex);
      previousSuccessMarkerIndex = successMarkerIndex;
    }
    expect(source).toContain(
      'printf \'shipfox-boot phase=%s status=%s uptime=%s\\n\' "$1" "$2" "$(uptime_seconds)"',
    );
    expect(source).toContain('emit_boot_phase "$boot_phase" fail');
    expect(source).toContain('lsblk -o NAME,TYPE,SIZE,PKNAME,PARTN,MOUNTPOINT');
    expect(source).toContain('findmnt /');
    expect(resolverSource).toContain('cat "/sys/class/block/$root_partition_name/partition"');
    expect(resolverSource).not.toContain('lsblk -ndo PARTN');
    expect(source).toContain('--verify-root-partition');
    expect(source).toContain('shipfox bootstrap whole-disk root verified: %s');
    expect(source).not.toContain('SHIPFOX_BOOTSTRAP_LIBRARY');
    expect(source).toContain('root_disk_size="$(cat "/sys/block/$root_disk_name/size"');
    expect(source).toContain(
      'root_partition_start="$(cat "/sys/block/$root_disk_name/$root_partition_name/start"',
    );
    expect(source).toContain(
      'root_partition_size="$(cat "/sys/block/$root_disk_name/$root_partition_name/size"',
    );
    expect(source).toContain('root_partition_end=$((root_partition_start + root_partition_size))');
    expect(source).toContain('if [ $((root_disk_size - root_partition_end)) -lt 2048 ]; then');
    expect(source).toContain('growpart "$root_disk" "$root_partition_number"');
    expect(source).toContain('2>&1)"; then');
    expect(source).toContain('*NOCHANGE*)');
    expect(source).toContain('resize2fs "$root_source"');
    expect(source).toContain('mkfs.ext4 -F -E lazy_itable_init=1,lazy_journal_init=1');
    expect(source).toContain('install -m 0600 -o root -g root');
    expect(source).toContain('mv -- "$runner_env_temp_path" "$runner_env_path"');
    expect(build).toContain(
      'shipfox-bootstrap.sh /opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh',
    );
    expect(build).toContain(
      'resolve-root-partition.sh /opt/shipfox-runner/scripts/runtime/helpers/resolve-root-partition.sh',
    );
    expect(build).toContain(
      'shipfox-bootstrap.service /etc/systemd/system/shipfox-bootstrap.service',
    );
    expect(build).toContain('systemctl enable shipfox-bootstrap.service');
    expect(build).toMatch(DEDICATED_SYSTEMD_VERIFY_PROVISIONER_PATTERN);
    expect(build).toContain('rm -f /etc/hostname');
  });

  it('classifies every readahead outcome without aborting bootstrap', async () => {
    const script = new URL('../scripts/runtime/shipfox-bootstrap.sh', import.meta.url);
    const source = await readFile(script, 'utf8');
    const functionStart = source.indexOf('configure_root_readahead() {');
    const functionEnd = source.indexOf('\nabort_boot() {', functionStart);
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);

    const harness = `set -eu
${source.slice(functionStart, functionEnd)}
uptime_seconds() {
  printf '%s\\n' 12
}
resolve_root_source() {
  if [ "$RUNNER_IMAGE_READAHEAD_SCENARIO" = root-source-unavailable ]; then
    return 1
  fi
  root_source='/dev/nvme0n1'
}
blockdev() {
  case "$1" in
    --getra)
      if [ "$RUNNER_IMAGE_READAHEAD_SCENARIO" = read-failed ]; then
          return 1
      fi
      if [ "$getra_after" = verify-failed ]; then
        return 1
      fi
      if [ -n "$getra_after" ]; then
        printf '%s\\n' "$getra_after"
      else
        printf '%s\\n' 256
      fi
      ;;
    --setra)
      [ "$2" = 2048 ]
      [ "$3" = /dev/nvme0n1 ]
      if [ "$RUNNER_IMAGE_READAHEAD_SCENARIO" = set-failed ]; then
        return 1
      fi
      case "$RUNNER_IMAGE_READAHEAD_SCENARIO" in
        verify-failed) getra_after=verify-failed ;;
        clamped) getra_after=1024 ;;
        applied) getra_after=2048 ;;
        *) return 2 ;;
      esac
      ;;
    *)
      return 2
      ;;
  esac
}
run_scenario() {
  RUNNER_IMAGE_READAHEAD_SCENARIO="$1"
  root_readahead_sectors="$2"
  getra_after=''
  configure_root_readahead
}
run_scenario not-configured ''
run_scenario invalid-target '1MiB'
run_scenario root-source-unavailable 2048
run_scenario read-failed 2048
run_scenario set-failed 2048
run_scenario verify-failed 2048
run_scenario clamped 2048
run_scenario applied 2048
`;

    const output = execFileSync('/bin/sh', ['-c', harness], {encoding: 'utf8'});

    expect(output).toBe(
      [
        'shipfox-boot phase=readahead status=skipped uptime=12 reason=not-configured',
        'shipfox-boot phase=readahead status=fail uptime=12 target_sectors=1MiB reason=invalid-target',
        'shipfox-boot phase=readahead status=fail uptime=12 reason=root-source-unavailable',
        'shipfox-boot phase=readahead status=fail uptime=12 root_source=/dev/nvme0n1 reason=read-failed',
        'shipfox-boot phase=readahead status=fail uptime=12 root_source=/dev/nvme0n1 before_sectors=256 target_sectors=2048 reason=set-failed',
        'shipfox-boot phase=readahead status=fail uptime=12 root_source=/dev/nvme0n1 before_sectors=256 target_sectors=2048 reason=verify-failed',
        'shipfox-boot phase=readahead status=fail uptime=12 root_source=/dev/nvme0n1 before_sectors=256 target_sectors=2048 after_sectors=1024 reason=clamped',
        'shipfox-boot phase=readahead status=ok uptime=12 root_source=/dev/nvme0n1 before_sectors=256 target_sectors=2048 after_sectors=2048',
        '',
      ].join('\n'),
    );
  });

  it('resolves a partitioned NVMe root from the kernel partition attribute', () => {
    const resolver = new URL(
      '../scripts/runtime/helpers/resolve-root-partition.sh',
      import.meta.url,
    );
    const result = execFileSync(
      '/bin/sh',
      [
        '-c',
        `set -eu
lsblk() {
  [ "$#" -eq 3 ]
  [ "$1" = -ndo ]
  [ "$2" = PKNAME ]
  [ "$3" = /dev/nvme0n1p4 ]
  printf '%s\\n' nvme0n1
}
cat() {
  [ "$#" -eq 1 ]
  [ "$1" = /sys/class/block/nvme0n1p4/partition ]
  printf ' 4\\n'
}
. "$1"
resolve_root_partition /dev/nvme0n1p4
printf '%s %s\\n' "$root_disk_name" "$root_partition_number"
`,
        'sh',
        resolver.pathname,
      ],
      {encoding: 'utf8'},
    );

    expect(result).toBe('nvme0n1 4\n');
  });

  it('skips a maximal root partition and tolerates growpart NOCHANGE', async () => {
    const script = new URL('../scripts/runtime/shipfox-bootstrap.sh', import.meta.url);
    const source = await readFile(script, 'utf8');
    const functionStart = source.indexOf('grow_root_filesystem() {');
    const functionEnd = source.indexOf('\nresolve_workspace_device() {', functionStart);
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);

    const root = await mkdtemp(join(tmpdir(), 'shipfox-root-growth-'));
    const commandDirectory = join(root, 'commands');
    const commandLog = join(root, 'command.log');
    await mkdir(commandDirectory, {recursive: true});
    await writeExecutable(
      join(commandDirectory, 'growpart'),
      `#!/bin/sh
set -eu
printf 'growpart %s\\n' "$RUNNER_IMAGE_GROW_SCENARIO" >> "$RUNNER_IMAGE_GROW_LOG"
case "$RUNNER_IMAGE_GROW_SCENARIO" in
  nochange)
    printf '%s\\n' 'NOCHANGE: partition 1 is already at maximum size' >&2
    exit 1
    ;;
  grow)
    printf '%s\\n' 'CHANGED: partition 1 grown'
    ;;
  *)
    exit 2
    ;;
esac
`,
    );
    await writeExecutable(
      join(commandDirectory, 'resize2fs'),
      `#!/bin/sh
set -eu
printf 'resize2fs %s %s\\n' "$RUNNER_IMAGE_GROW_SCENARIO" "$1" >> "$RUNNER_IMAGE_GROW_LOG"
`,
    );

    const harness = `set -eu
${source.slice(functionStart, functionEnd)}
resolve_root_source() {
  root_source='/dev/nvme0n1p1'
}
resolve_root_partition() {
  root_disk_name='nvme0n1'
  root_partition_name='nvme0n1p1'
  root_partition_number='1'
}
abort_boot() {
  printf 'abort %s\\n' "$1" >> "$RUNNER_IMAGE_GROW_LOG"
  exit 1
}
lsblk() {
  [ "$1" = '-ndo' ]
  [ "$2" = 'TYPE' ]
  printf '%s\\n' part
}
cat() {
  case "$1" in
    /sys/block/nvme0n1/size)
      printf '%s\\n' 100000
      ;;
    /sys/block/nvme0n1/nvme0n1p1/start)
      printf '%s\\n' 2048
      ;;
    /sys/block/nvme0n1/nvme0n1p1/size)
      case "$RUNNER_IMAGE_GROW_SCENARIO" in
        equal) printf '%s\\n' 97919 ;;
        nochange|grow) printf '%s\\n' 90000 ;;
        *) exit 2 ;;
      esac
      ;;
    *)
      exit 2
      ;;
  esac
}
run_scenario() {
  export RUNNER_IMAGE_GROW_SCENARIO="$1"
  grow_root_filesystem
}
run_scenario equal
run_scenario nochange
run_scenario grow
`;

    try {
      const output = execFileSync('/bin/sh', ['-c', harness], {
        env: {
          ...process.env,
          PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
          RUNNER_IMAGE_GROW_LOG: commandLog,
        },
        encoding: 'utf8',
      });

      expect(output).toContain('NOCHANGE: partition 1 is already at maximum size');
      expect(await readFile(commandLog, 'utf8')).toBe(
        'growpart nochange\nresize2fs nochange /dev/nvme0n1p1\ngrowpart grow\nresize2fs grow /dev/nvme0n1p1\n',
      );
    } finally {
      await rm(root, {force: true, recursive: true});
    }
  });

  it('resolves the root device and publishes a boot I/O sample', async () => {
    const script = new URL('../scripts/runtime/record-boot-io.sh', import.meta.url);
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');
    const source = await readFile(script, 'utf8');

    execFileSync('sh', ['-n', script.pathname], {stdio: 'pipe'});

    expect(source).toContain('findmnt -no SOURCE / || true');
    expect(source).toContain('lsblk -no PKNAME "$root_source" 2>/dev/null | head -n1 | tr -d');
    expect(source).toContain('if [ -e /run/shipfox/boot-io ]; then');
    expect(source).toContain('ln -- "$temporary_path" /run/shipfox/boot-io');
    expect(source).toContain('read -r read_ops _ read_sectors _');
    expect(source).toContain('/sys/block/$root_device/stat');
    expect(source).toContain('/run/shipfox/boot-io');
    expect(source).toContain('trap on_exit EXIT');
    expect(source).toContain('trap on_signal HUP INT TERM');
    expect(source).toContain('emit_boot_io_marker ok');
    expect(source).toContain('emit_boot_io_marker fail');
    expect(source).toContain(
      "printf 'shipfox-boot phase=boot-io status=ok uptime=%s root_device=%s read_ops=%s read_sectors=%s\\n'",
    );
    expect(source).toContain(
      'printf \'shipfox-boot phase=boot-io status=fail uptime=%s\\n\' "$uptime_seconds"',
    );
    expect(build).toContain(
      'record-boot-io.sh /opt/shipfox-runner/scripts/runtime/record-boot-io.sh',
    );
    expect(build).toContain('SHIPFOX_IMAGE_REVISION=$' + '{var.revision}');
    expect(build).toContain('/etc/shipfox/image-revision');
  });

  it('records a durable boot marker before starting the runner', async () => {
    const marker = await readUnit('shipfox-runner-boot-complete.service');
    const runner = await readUnit('shipfox-runner.service');

    expect(marker).toContain('/var/lib/shipfox/boot-complete');
    expect(marker).toContain('Before=shipfox-runner.service');
    expect(runner).toContain('shipfox-runner-boot-complete.service');
    expect(marker).not.toContain('cloud-config.service');
    expect(marker).not.toContain('cloud-final.service');
  });
});

describe('runner container entrypoint', () => {
  it('starts the compiled runner and verifies its production closure', async () => {
    const dockerfile = await readFile(
      new URL('../../../../apps/runner/Dockerfile', import.meta.url),
      'utf8',
    );
    const verifyInstallation = await readFile(
      new URL('../../../../apps/runner/src/verify-installation.ts', import.meta.url),
      'utf8',
    );

    expect(dockerfile).toContain('RUN node ./dist/verify-installation.js');
    expect(verifyInstallation).toContain("'@shipfox/runner-execution/git-credential-helper'");
    expect(verifyInstallation).toContain("'./git-credential-helper.js'");
    expect(dockerfile).toContain('ENV SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT=true');
    expect(dockerfile.indexOf('RUN node ./dist/verify-installation.js')).toBeLessThan(
      dockerfile.indexOf('ENV SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT=true'),
    );
    expect(dockerfile).toContain('ENTRYPOINT ["tini", "--"]');
    expect(dockerfile).toContain('CMD ["node", "./dist/index.js"]');
    expect(dockerfile).not.toContain('--enable-source-maps');
  });
});

describe('runner boot configuration', () => {
  const script = new URL('../scripts/build/configure-boot.sh', import.meta.url);

  it('applies filesystem and fsck settings against a checked image fixture', async () => {
    const fstab = `# fstab
UUID=root / ext4 defaults 0 1
UUID=boot /boot ext4 defaults 0 1 extra-column
UUID=efi /boot/efi vfat defaults 0 1
UUID=data /data ext4 defaults 0 2
`;
    const fixture = await createBootFixture(fstab);
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');

    try {
      execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});
      execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});

      expect(build).toContain('scripts/build/configure-boot.sh');
      expect(await readFile(join(fixture.root, 'boot/grub/grub.cfg'), 'utf8')).toContain(
        'fsck.mode=skip',
      );
      expect(await readFile(join(fixture.root, 'etc/systemd/default-target'), 'utf8')).toBe(
        'multi-user.target\n',
      );
      expect(await readFile(join(fixture.root, 'etc/systemd/systemctl.log'), 'utf8')).toBe(
        'mask systemd-fsck-root.service\nmask systemd-fsck-root.service\n',
      );
      expect(await readFile(join(fixture.root, 'etc/fstab'), 'utf8')).toBe(`# fstab
UUID=root / ext4 defaults,noatime 0 1
UUID=boot /boot ext4 defaults,noatime,noauto 0 0 extra-column
UUID=efi /boot/efi vfat defaults,noauto 0 0
UUID=data /data ext4 defaults 0 2
`);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails before touching fstab when default target verification disagrees', async () => {
    const fstab = `# fstab
UUID=root / ext4 defaults 0 1
UUID=boot /boot ext4 defaults 0 1
UUID=efi /boot/efi vfat defaults 0 1
`;
    const fixture = await createBootFixture(fstab);

    try {
      expect(() =>
        execFileSync('sh', [script.pathname], {
          env: {
            ...fixture.environment,
            RUNNER_IMAGE_SYSTEMCTL_DEFAULT_TARGET: 'graphical.target',
          },
          stdio: 'pipe',
        }),
      ).toThrow();
      expect(await readFile(join(fixture.root, 'etc/fstab'), 'utf8')).toBe(fstab);
      expect(await readFile(join(fixture.root, 'etc/systemd/default-target'), 'utf8')).toBe(
        'multi-user.target\n',
      );
      expect(await pathExists(join(fixture.root, 'etc/systemd/systemctl.log'))).toBe(false);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails before publishing an image when a target fstab entry is malformed', async () => {
    const fstab = 'UUID=root / ext4 defaults\n';
    const fixture = await createBootFixture(fstab);

    try {
      expect(() =>
        execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'}),
      ).toThrow();
      expect(await readFile(join(fixture.root, 'etc/fstab'), 'utf8')).toBe(fstab);
      expect(await pathExists(join(fixture.root, 'etc/systemd/default-target'))).toBe(false);
      expect(await pathExists(join(fixture.root, 'etc/systemd/systemctl.log'))).toBe(false);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails before publishing an image when a boot fstab entry is missing', async () => {
    const fstab = `# fstab
UUID=root / ext4 defaults 0 1
UUID=efi /boot/efi vfat defaults 0 1
`;
    const fixture = await createBootFixture(fstab);

    try {
      expect(() =>
        execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'}),
      ).toThrow();
      expect(await readFile(join(fixture.root, 'etc/fstab'), 'utf8')).toBe(fstab);
      expect(await pathExists(join(fixture.root, 'etc/systemd/default-target'))).toBe(false);
      expect(await pathExists(join(fixture.root, 'etc/systemd/systemctl.log'))).toBe(false);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it.each(['NOAUTO', 'NoAuto'])('canonicalizes an existing %s fstab option', async (option) => {
    const fstab = `# fstab
UUID=root / ext4 defaults 0 1
UUID=boot /boot ext4 defaults,noatime,${option} 0 1 extra-column
UUID=efi /boot/efi vfat defaults,${option} 0 1
`;
    const fixture = await createBootFixture(fstab);

    try {
      execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});
      execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});

      expect(await readFile(join(fixture.root, 'etc/fstab'), 'utf8')).toBe(`# fstab
UUID=root / ext4 defaults,noatime 0 1
UUID=boot /boot ext4 defaults,noatime,noauto 0 0 extra-column
UUID=efi /boot/efi vfat defaults,noauto 0 0
`);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('normalizes space-padded fstab options', async () => {
    const fstab = `# fstab
UUID=root / ext4 defaults 0 1
UUID=boot /boot ext4 defaults, noauto 0 1
UUID=efi /boot/efi vfat defaults, NoAuto 0 1
`;
    const fixture = await createBootFixture(fstab);

    try {
      execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});

      expect(await readFile(join(fixture.root, 'etc/fstab'), 'utf8')).toBe(`# fstab
UUID=root / ext4 defaults,noatime 0 1
UUID=boot /boot ext4 defaults,noauto,noatime 0 0
UUID=efi /boot/efi vfat defaults,noauto 0 0
`);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('configures the primary link by interface family rather than through netplan', async () => {
    const network = await readFile(
      new URL('../assets/shipfox-primary.network', import.meta.url),
      'utf8',
    );
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');

    expect(systemdDirective(network, 'Match', 'Name')).toBe('en* eth*');
    expect(systemdDirective(network, 'Match', 'Type')).toBe('ether');
    expect(systemdDirective(network, 'Link', 'RequiredForOnline')).toBe('routable');
    expect(systemdDirective(network, 'Network', 'DHCP')).toBe('ipv4');
    expect(systemdDirective(network, 'Network', 'IPv6DuplicateAddressDetection')).toBe('0');
    expect(systemdDirective(network, 'DHCPv4', 'UseMTU')).toBe('true');
    expect(build).toContain(
      'shipfox-primary.network /etc/systemd/network/10-shipfox-primary.network',
    );
    expect(build).toContain('systemctl enable systemd-networkd.service systemd-resolved.service');
    expect(build).toContain('rm -f /etc/netplan/*.yaml');
    expect(build).not.toContain('/etc/netplan/01-shipfox.yaml');
    expect(build).not.toContain('10-netplan-primary.network.d');
  });

  it('keeps a second interface from holding the online wait open', async () => {
    const dropIn = await readFile(
      new URL('../assets/shipfox-networkd-wait-online.conf', import.meta.url),
      'utf8',
    );
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');

    expect(dropIn).toContain('ExecStart=\n');
    expect(dropIn).toContain(
      'ExecStart=/usr/lib/systemd/systemd-networkd-wait-online --any --timeout=30\n',
    );
    expect(build).toContain(
      'shipfox-networkd-wait-online.conf /etc/systemd/system/systemd-networkd-wait-online.service.d/10-shipfox.conf',
    );
    expect(build).toContain('test -x /usr/lib/systemd/systemd-networkd-wait-online');
  });

  it('proves the shipped network configuration against the live link during the bake', async () => {
    const script = new URL('../scripts/build/verify-network.sh', import.meta.url);
    const source = await readFile(script, 'utf8');
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');

    execFileSync('sh', ['-n', script.pathname], {stdio: 'pipe'});

    expect(source).toContain('rm -f /run/systemd/network/*-netplan-*.network');
    expect(source).toContain('networkctl reconfigure "$primary_interface"');
    expect(source).toContain('*"Network File: $network_unit"*)');
    expect(source).toContain("*'State: routable'*)");
    expect(build).toContain('scripts/build/verify-network.sh');
    expect(build).toContain('http://169.254.169.254/latest/api/token');
  });
});

describe('runner image composition', () => {
  it('verifies the baked system capabilities against architecture-specific requirements', async () => {
    const script = new URL('../scripts/build/verify-composition.sh', import.meta.url);
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');
    const source = await readFile(script, 'utf8');
    const fixture = await createCompositionFixture();

    try {
      execFileSync('/bin/sh', ['-n', script.pathname], {stdio: 'pipe'});
      execFileSync('/bin/sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});

      expect(source).toContain(
        'systemctl list-unit-files --state=enabled --no-legend --no-pager --plain',
      );
      expect(source).toContain(
        'systemctl list-unit-files --state=masked --no-legend --no-pager --plain',
      );
      expect(source).toContain('systemctl get-default');
      expect(source).toContain('fsck.mode=skip');
      expect(source).toContain('dpkg-query');
      expect(source).toContain('cloud-guest-utils');
      expect(source).toContain('command -v growpart');
      expect(build).toContain(`composition/\${var.image_os}/\${var.architecture}`);
      expect(build).toContain('scripts/build/verify-composition.sh');
      expect(build.indexOf('scripts/build/configure-ephemeral-boot.sh')).toBeLessThan(
        build.indexOf('scripts/build/verify-composition.sh'),
      );
      expect(build.indexOf('scripts/build/verify-composition.sh')).toBeLessThan(
        build.indexOf('systemctl enable systemd-networkd.service systemd-resolved.service'),
      );
      expect(build.indexOf('scripts/build/verify-composition.sh')).toBeLessThan(
        build.indexOf(
          'shipfox-bootstrap.sh /opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh',
        ),
      );
      expect(
        build.indexOf(
          'shipfox-bootstrap.sh /opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh',
        ),
      ).toBeLessThan(
        build.indexOf(
          '/opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh --verify-root-partition',
        ),
      );
      expect(build.indexOf('sudo passwd --lock ubuntu')).toBeGreaterThan(
        build.indexOf(
          '/opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh --verify-root-partition',
        ),
      );
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('allows unrelated unit inventory changes', async () => {
    const script = new URL('../scripts/build/verify-composition.sh', import.meta.url);
    const fixture = await createCompositionFixture();

    try {
      execFileSync('/bin/sh', [script.pathname], {
        env: {
          ...fixture.environment,
          RUNNER_IMAGE_ENABLED_INVENTORY: `${fixture.enabledInventory}\nunrelated.service enabled`,
          RUNNER_IMAGE_MASKED_INVENTORY: `${fixture.maskedInventory}\nunrelated.timer masked`,
        },
        stdio: 'pipe',
      });
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails the image bake when a required enabled unit is missing', async () => {
    const script = new URL('../scripts/build/verify-composition.sh', import.meta.url);
    const fixture = await createCompositionFixture();

    try {
      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {
          env: {
            ...fixture.environment,
            RUNNER_IMAGE_ENABLED_INVENTORY: fixture.enabledInventory.replace(
              'ssh.socket enabled',
              'ssh.socket disabled',
            ),
          },
          stdio: 'pipe',
        }),
      ).toThrow('ssh.socket enabled');
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails the image bake when a masked unit is unmasked or a forbidden package remains', async () => {
    const script = new URL('../scripts/build/verify-composition.sh', import.meta.url);
    const fixture = await createCompositionFixture();

    try {
      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {
          env: {
            ...fixture.environment,
            RUNNER_IMAGE_MASKED_INVENTORY: 'maintenance.service enabled',
          },
          stdio: 'pipe',
        }),
      ).toThrow('maintenance.service');

      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {
          env: {
            ...fixture.environment,
            RUNNER_IMAGE_INSTALLED_PACKAGES: 'cloud-guest-utils ec2-instance-connect snapd',
          },
          stdio: 'pipe',
        }),
      ).toThrow('snapd');
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails the image bake when required disk tooling is missing', async () => {
    const script = new URL('../scripts/build/verify-composition.sh', import.meta.url);
    const fixture = await createCompositionFixture();

    try {
      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {
          env: {
            ...fixture.environment,
            RUNNER_IMAGE_INSTALLED_PACKAGES: 'ec2-instance-connect',
          },
          stdio: 'pipe',
        }),
      ).toThrow('cloud-guest-utils');
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('creates and enables a 4 GiB swap file', async () => {
    const script = new URL('../scripts/build/setup-runner.sh', import.meta.url);
    const fixture = await createRunnerImageSetupFixture();

    try {
      execFileSync('/bin/sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});

      const events = (await readFile(fixture.commandLog, 'utf8')).trim().split('\n');
      const fallocateIndex = events.indexOf(`fallocate -l 4G ${join(fixture.root, 'swapfile')}`);
      const chmodIndex = events.indexOf(`chmod 600 ${join(fixture.root, 'swapfile')}`);
      const mkswapIndex = events.indexOf(`mkswap ${join(fixture.root, 'swapfile')}`);
      const swaponIndex = events.indexOf(`swapon ${join(fixture.root, 'swapfile')}`);

      expect(fallocateIndex).toBeGreaterThanOrEqual(0);
      expect(chmodIndex).toBeGreaterThan(fallocateIndex);
      expect(mkswapIndex).toBeGreaterThan(chmodIndex);
      expect(swaponIndex).toBeGreaterThan(mkswapIndex);
      expect((await stat(join(fixture.root, 'swapfile'))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(fixture.root, 'etc/fstab'), 'utf8')).toContain(
        '/swapfile none swap sw 0 0\n',
      );
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('unmounts seeded snaps, purges snapd, and removes its image state', async () => {
    const script = new URL('../scripts/build/setup-runner.sh', import.meta.url);
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');
    const fixture = await createRunnerImageSetupFixture();

    try {
      execFileSync('/bin/sh', [script.pathname], {
        env: {
          ...fixture.environment,
          RUNNER_IMAGE_FAIL_UMOUNT: join(fixture.root, 'snap/amazon-ssm-agent'),
        },
        stdio: 'pipe',
      });

      const events = (await readFile(fixture.commandLog, 'utf8')).trim().split('\n');
      const stopIndex = events.indexOf(
        'systemctl stop snapd.seeded.service snapd.service snapd.socket',
      );
      const purgeIndex = events.indexOf('apt-get purge --yes snapd');
      const unmountEvents = events.filter((event) => event.startsWith('umount '));

      expect(build).toContain('scripts/build/setup-runner.sh');
      expect(stopIndex).toBeGreaterThanOrEqual(0);
      expect(purgeIndex).toBeGreaterThan(stopIndex);
      expect(
        events.find((event) => event.startsWith('apt-get install --yes --no-install-recommends ')),
      ).toContain('amazon-ec2-utils ec2-instance-connect');
      expect(events).toContain('apt-get purge --yes cloud-init');
      expect(unmountEvents).toHaveLength(5);
      expect(unmountEvents).toContain(`umount -l ${join(fixture.root, 'snap/amazon-ssm-agent')}`);
      expect(unmountEvents.every((event) => events.indexOf(event) < purgeIndex)).toBe(true);
      expect(await pathExists(join(fixture.root, 'snap'))).toBe(false);
      expect(await pathExists(join(fixture.root, 'snap/amazon-ssm-agent'))).toBe(false);
      expect(await pathExists(join(fixture.root, 'var/lib/snapd'))).toBe(false);
      expect(await pathExists(join(fixture.root, 'etc/cloud'))).toBe(false);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails the image bake when the snapd purge fails', async () => {
    const script = new URL('../scripts/build/setup-runner.sh', import.meta.url);
    const fixture = await createRunnerImageSetupFixture();

    try {
      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {
          env: {...fixture.environment, RUNNER_IMAGE_FAIL_PURGE: '1'},
          stdio: 'pipe',
        }),
      ).toThrow();

      expect(await pathExists(join(fixture.root, 'snap'))).toBe(true);
      expect(await readFile(fixture.commandLog, 'utf8')).not.toContain(
        `rm -rf ${join(fixture.root, 'snap')}`,
      );
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails the image bake when snapd artifacts remain after purge', async () => {
    const script = new URL('../scripts/build/setup-runner.sh', import.meta.url);
    const fixture = await createRunnerImageSetupFixture();

    try {
      await writeExecutable(join(fixture.root, 'usr/bin/snap'), '#!/bin/sh\nexit 0\n');

      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'}),
      ).toThrow();
      expect(await pathExists(join(fixture.root, 'usr/bin/snap'))).toBe(true);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails the image bake when snap remains available on PATH', async () => {
    const script = new URL('../scripts/build/setup-runner.sh', import.meta.url);
    const fixture = await createRunnerImageSetupFixture();

    try {
      await writeExecutable(join(fixture.commandDirectory, 'snap'), '#!/bin/sh\nexit 0\n');

      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'}),
      ).toThrow();
      expect(await pathExists(join(fixture.root, 'snap'))).toBe(false);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });
});

describe('runner installation', () => {
  it('verifies the staged runtime and installs the helper on the runner PATH', async () => {
    const script = new URL('../scripts/build/install-runner.sh', import.meta.url);
    const fixture = await createRunnerInstallFixture();

    try {
      execFileSync('/bin/sh', [script.pathname], {
        env: fixture.environment,
        stdio: 'pipe',
      });

      expect(await pathExists(fixture.workspace)).toBe(false);
      expect(await readFile(fixture.commandLog, 'utf8')).toContain(
        `pnpm --filter=@shipfox/runner deploy --prod --legacy --config.strict-peer-dependencies=false ${fixture.runnerDirectory}`,
      );
      expect(await readFile(fixture.commandLog, 'utf8')).toContain(
        `node ${fixture.runnerDirectory}/dist/verify-installation.js`,
      );
      expect(await readlink(fixture.helperPath)).toBe(
        `${fixture.runnerDirectory}/dist/git-credential-helper.js`,
      );
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it.each([
    'helper',
    'entrypoint',
  ] as const)('fails the staged runtime check when the %s is missing', async (missingRuntime) => {
    const script = new URL('../scripts/build/install-runner.sh', import.meta.url);
    const fixture = await createRunnerInstallFixture({missingRuntime});

    try {
      expect(() =>
        execFileSync('/bin/sh', [script.pathname], {
          env: fixture.environment,
          stdio: 'pipe',
        }),
      ).toThrow();
      expect(await pathExists(fixture.workspace)).toBe(true);
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });
});

async function createBootFixture(fstab: string) {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-runner-boot-'));
  const commandDirectory = join(root, 'commands');

  await mkdir(join(root, 'boot/grub'), {recursive: true});
  await mkdir(join(root, 'etc/default/grub.d'), {recursive: true});
  await mkdir(join(root, 'etc/systemd'), {recursive: true});
  await mkdir(commandDirectory, {recursive: true});
  await writeFile(join(root, 'etc/default/grub'), 'GRUB_CMDLINE_LINUX_DEFAULT="console=tty1"\n');
  await writeFile(
    join(root, 'etc/default/grub.d/50-cloudimg-settings.cfg'),
    `GRUB_CMDLINE_LINUX_DEFAULT="\${GRUB_CMDLINE_LINUX_DEFAULT} console=ttyS0"\n`,
  );
  await writeFile(join(root, 'etc/fstab'), fstab);
  await writeFile(
    join(commandDirectory, 'update-grub'),
    [
      '#!/bin/sh',
      'set -eu',
      `root_dir=\${RUNNER_IMAGE_ROOT:?}`,
      '. "$root_dir/etc/default/grub"',
      'for dropin in "$root_dir"/etc/default/grub.d/*.cfg; do',
      '  [ -e "$dropin" ] || continue',
      '  . "$dropin"',
      'done',
      `printf "%s\\n" "linux \${GRUB_CMDLINE_LINUX_DEFAULT-}" > "$root_dir/boot/grub/grub.cfg"`,
      '',
    ].join('\n'),
  );
  await writeFile(
    join(commandDirectory, 'systemctl'),
    [
      '#!/bin/sh',
      'set -eu',
      `root_dir=\${RUNNER_IMAGE_ROOT:?}`,
      'case "$1" in',
      '  set-default)',
      '    [ "$#" -eq 2 ]',
      '    [ "$2" = multi-user.target ]',
      '    printf "%s\\n" "$2" > "$root_dir/etc/systemd/default-target"',
      '    ;;',
      '  get-default)',
      '    [ "$#" -eq 1 ]',
      `    if [ -n "\${RUNNER_IMAGE_SYSTEMCTL_DEFAULT_TARGET:-}" ]; then`,
      '      printf "%s\\n" "$RUNNER_IMAGE_SYSTEMCTL_DEFAULT_TARGET"',
      '    else',
      '      cat "$root_dir/etc/systemd/default-target"',
      '    fi',
      '    ;;',
      '  mask)',
      '    [ "$#" -eq 2 ]',
      '    [ "$2" = systemd-fsck-root.service ]',
      '    printf "%s\\n" "$*" >> "$root_dir/etc/systemd/systemctl.log"',
      '    ;;',
      '  *)',
      '    exit 1',
      '    ;;',
      'esac',
      '',
    ].join('\n'),
  );
  await chmod(join(commandDirectory, 'update-grub'), 0o755);
  await chmod(join(commandDirectory, 'systemctl'), 0o755);

  return {
    root,
    environment: {
      ...process.env,
      PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
      RUNNER_IMAGE_ROOT: root,
    },
  };
}

async function createRunnerImageSetupFixture() {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-runner-setup-'));
  const commandDirectory = join(root, 'commands');
  const commandLog = join(root, 'command.log');

  await mkdir(join(root, 'snap/amazon-ssm-agent'), {recursive: true});
  await mkdir(join(root, 'snap/core22'), {recursive: true});
  await mkdir(join(root, 'snap/snapd'), {recursive: true});
  await mkdir(join(root, 'var/lib/snapd'), {recursive: true});
  await mkdir(join(root, 'var/lib/apt/lists'), {recursive: true});
  await mkdir(join(root, 'etc/cloud'), {recursive: true});
  await mkdir(join(root, 'usr/bin'), {recursive: true});
  await mkdir(join(root, 'usr/local/bin'), {recursive: true});
  await mkdir(join(root, 'etc/default'), {recursive: true});
  await mkdir(join(root, 'etc/sudoers.d'), {recursive: true});
  await mkdir(commandDirectory, {recursive: true});
  await writeFile(join(root, 'etc/fstab'), '# fstab\n');

  await writeExecutable(
    join(commandDirectory, 'apt-get'),
    `#!/bin/sh
set -eu
printf 'apt-get %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
if [ "$1" = purge ] && [ "\${3:-}" = snapd ] && [ -n "\${RUNNER_IMAGE_FAIL_PURGE:-}" ]; then
  exit 1
fi
`,
  );
  await writeExecutable(
    join(commandDirectory, 'fallocate'),
    `#!/bin/sh
set -eu
printf 'fallocate %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
last=''
for argument; do
  last="$argument"
done
: > "$last"
`,
  );
  await writeExecutable(
    join(commandDirectory, 'systemctl'),
    `#!/bin/sh
set -eu
printf 'systemctl %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
[ "$1" = stop ]
`,
  );
  await writeExecutable(
    join(commandDirectory, 'umount'),
    `#!/bin/sh
set -eu
printf 'umount %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
if [ "\${RUNNER_IMAGE_FAIL_UMOUNT:-}" = "$1" ]; then
  exit 1
fi
`,
  );
  await writeExecutable(
    join(commandDirectory, 'rm'),
    `#!/bin/sh
set -eu
printf 'rm %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
exec /bin/rm "$@"
`,
  );
  await writeExecutable(
    join(commandDirectory, 'install'),
    `#!/bin/sh
set -eu
last=''
for argument; do
  last="$argument"
done
/bin/mkdir -p "$last"
`,
  );
  await writeExecutable(join(commandDirectory, 'ln'), '#!/bin/sh\nexec /bin/ln "$@"\n');
  await writeExecutable(
    join(commandDirectory, 'chmod'),
    `#!/bin/sh
set -eu
printf 'chmod %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
exec /bin/chmod "$@"
`,
  );
  await writeExecutable(
    join(commandDirectory, 'mkswap'),
    `#!/bin/sh
set -eu
printf 'mkswap %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
`,
  );
  await writeExecutable(
    join(commandDirectory, 'swapon'),
    `#!/bin/sh
set -eu
printf 'swapon %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
`,
  );
  await writeExecutable(join(commandDirectory, 'groupadd'), '#!/bin/sh\nexit 0\n');
  await writeExecutable(join(commandDirectory, 'id'), '#!/bin/sh\nexit 1\n');
  await writeExecutable(join(commandDirectory, 'useradd'), '#!/bin/sh\nexit 0\n');
  await writeExecutable(join(commandDirectory, 'fdfind'), '#!/bin/sh\nexit 0\n');

  return {
    commandLog,
    commandDirectory,
    environment: {
      ...process.env,
      PATH: commandDirectory,
      RUNNER_IMAGE_COMMAND_LOG: commandLog,
      RUNNER_IMAGE_ROOT: root,
    },
    root,
  };
}

async function createRunnerInstallFixture(
  options: {missingRuntime?: 'helper' | 'entrypoint'} = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-runner-install-'));
  const commandDirectory = join(root, 'commands');
  const workspace = join(root, 'tmp/shipfox-runner-workspace');
  const commandLog = join(root, 'command.log');
  const runnerDirectory = join(root, 'opt/runner');
  const helperPath = join(root, 'usr/local/bin/git-credential-shipfox');

  await mkdir(join(workspace, 'package'), {recursive: true});
  await mkdir(join(runnerDirectory, 'dist'), {recursive: true});
  await mkdir(commandDirectory, {recursive: true});
  await writeFile(join(workspace, 'package/pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await writeExecutable(join(commandDirectory, 'corepack'), '#!/bin/sh\nexit 0\n');
  await writeExecutable(
    join(commandDirectory, 'pnpm'),
    `#!/bin/sh
set -eu
printf 'pnpm %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
mkdir -p "$RUNNER_IMAGE_RUNNER_DIR/dist"
: > "$RUNNER_IMAGE_RUNNER_DIR/dist/index.js"
if [ "\${RUNNER_IMAGE_MISSING_RUNTIME:-}" != helper ]; then
  printf '#!/bin/sh\\n' > "$RUNNER_IMAGE_RUNNER_DIR/dist/git-credential-helper.js"
  chmod 755 "$RUNNER_IMAGE_RUNNER_DIR/dist/git-credential-helper.js"
fi
if [ "\${RUNNER_IMAGE_MISSING_RUNTIME:-}" = entrypoint ]; then
  rm -f "$RUNNER_IMAGE_RUNNER_DIR/dist/index.js"
fi
`,
  );
  await writeExecutable(
    join(commandDirectory, 'node'),
    `#!/bin/sh
set -eu
printf 'node %s\\n' "$*" >> "$RUNNER_IMAGE_COMMAND_LOG"
if [ "$1" = "$RUNNER_IMAGE_RUNNER_DIR/dist/verify-installation.js" ]; then
  test -f "$RUNNER_IMAGE_RUNNER_DIR/dist/index.js"
  test -x "$RUNNER_IMAGE_RUNNER_DIR/dist/git-credential-helper.js"
fi
`,
  );
  await writeExecutable(join(commandDirectory, 'chown'), '#!/bin/sh\nexit 0\n');

  return {
    commandLog,
    environment: {
      ...process.env,
      PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
      RUNNER_IMAGE_COMMAND_LOG: commandLog,
      RUNNER_IMAGE_ROOT: root,
      RUNNER_IMAGE_MISSING_RUNTIME: options.missingRuntime ?? '',
      RUNNER_IMAGE_RUNNER_DIR: runnerDirectory,
    },
    helperPath,
    root,
    runnerDirectory,
    workspace,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function createCompositionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-runner-composition-'));
  const commandDirectory = join(root, 'commands');
  const compositionDirectory = join(root, 'composition');
  const enabledRequirements = [
    'apparmor.service enabled',
    'ec2-instance-connect-harvest-hostkeys.service enabled',
    'ssh.socket enabled',
  ].join('\n');
  const maskedRequirements = 'maintenance.service masked';
  // A live base image enables and masks many units the image never requires, so the
  // fixture inventories stay supersets of the committed requirements.
  const enabledInventory = [
    enabledRequirements,
    'getty@.service enabled',
    'systemd-pstore.service enabled',
  ].join('\n');
  const maskedInventory = [maskedRequirements, 'plymouth-quit.service masked'].join('\n');

  await mkdir(commandDirectory, {recursive: true});
  await mkdir(compositionDirectory, {recursive: true});
  await writeFile(join(root, 'grub.cfg'), 'linux /vmlinuz fsck.mode=skip\n');
  await writeFile(
    join(root, 'fstab'),
    `UUID=root / ext4 defaults,noatime 0 1
UUID=boot /boot ext4 defaults,noatime,noauto 0 0
UUID=efi /boot/efi vfat defaults,noauto 0 0
`,
  );
  await writeFile(join(compositionDirectory, 'required-enabled.txt'), `${enabledRequirements}\n`);
  await writeFile(join(compositionDirectory, 'required-masked.txt'), `${maskedRequirements}\n`);

  await writeExecutable(
    join(commandDirectory, 'systemctl'),
    [
      '#!/bin/sh',
      'set -eu',
      'case "$1" in',
      '  list-unit-files)',
      '    case "$2" in',
      '      --state=enabled) printf "%s\\n" "$RUNNER_IMAGE_ENABLED_INVENTORY" ;;',
      '      --state=masked) printf "%s\\n" "$RUNNER_IMAGE_MASKED_INVENTORY" ;;',
      '      *) exit 2 ;;',
      '    esac',
      '    ;;',
      '  get-default)',
      `    printf "%s\\n" "\${RUNNER_IMAGE_DEFAULT_TARGET:-multi-user.target}"`,
      '    ;;',
      '  cat)',
      `    [ "\${SYSTEMCTL_MISSING_UNIT:-}" != "$2" ]`,
      '    ;;',
      '  is-enabled)',
      '    printf "%s\\n" enabled',
      '    ;;',
      '  *) exit 2 ;;',
      'esac',
    ].join('\n'),
  );
  await writeExecutable(
    join(commandDirectory, 'systemd-analyze'),
    [
      '#!/bin/sh',
      'set -eu',
      '[ "$1" = cat-config ]',
      `printf "[Journal]\\nStorage=%s\\n" "\${RUNNER_IMAGE_JOURNAL_STORAGE:-volatile}"`,
    ].join('\n'),
  );
  await writeExecutable(
    join(commandDirectory, 'dpkg-query'),
    [
      '#!/bin/sh',
      'set -eu',
      "package=''",
      'for argument; do package="$argument"; done',
      `case " \${RUNNER_IMAGE_INSTALLED_PACKAGES:-} " in`,
      '  *" $package "*) printf "%s\\n" "install ok installed" ;;',
      '  *) printf "%s\\n" "unknown ok not-installed" ;;',
      'esac',
    ].join('\n'),
  );
  await writeExecutable(join(commandDirectory, 'growpart'), '#!/bin/sh\nexit 0\n');

  return {
    enabledInventory,
    environment: {
      ...process.env,
      PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
      RUNNER_IMAGE_ENABLED_INVENTORY: enabledInventory,
      RUNNER_IMAGE_INSTALLED_PACKAGES: 'cloud-guest-utils ec2-instance-connect',
      RUNNER_IMAGE_MASKED_INVENTORY: maskedInventory,
      SHIPFOX_FSTAB: join(root, 'fstab'),
      SHIPFOX_GRUB_CONFIG: join(root, 'grub.cfg'),
      SHIPFOX_RUNNER_COMPOSITION_DIR: compositionDirectory,
      SHIPFOX_RUNNER_IMAGE_ARCHITECTURE: 'amd64',
      SHIPFOX_RUNNER_IMAGE_OS: 'ubuntu24',
    },
    maskedInventory,
    root,
  };
}

describe('ephemeral boot configuration', () => {
  it('masks disposable boot services and stores the journal in memory', async () => {
    const script = new URL('../scripts/build/configure-ephemeral-boot.sh', import.meta.url);
    const build = await readFile(new URL('../build.pkr.hcl', import.meta.url), 'utf8');

    const fixture = await createEphemeralBootFixture();

    try {
      execFileSync('sh', ['-n', script.pathname], {stdio: 'pipe'});
      execFileSync('sh', [script.pathname], {env: fixture.environment, stdio: 'pipe'});

      expect((await readFile(fixture.maskLog, 'utf8')).trim().split(WHITESPACE_PATTERN)).toEqual([
        '--now',
        ...EPHEMERAL_BOOT_MASKED_UNITS,
      ]);
      expect((await readFile(fixture.catLog, 'utf8')).trim().split('\n')).toEqual([
        ...EPHEMERAL_BOOT_MASKED_UNITS,
      ]);
      expect(await readFile(fixture.journalDropIn, 'utf8')).toBe(
        '[Journal]\nStorage=volatile\nRuntimeMaxUse=64M\nRateLimitIntervalSec=30s\nRateLimitBurst=1000\n',
      );

      const scriptsStart = build.indexOf('scripts = [');
      const scriptsEnd = build.indexOf('\n    ]', scriptsStart);
      expect(scriptsStart).toBeGreaterThanOrEqual(0);
      expect(scriptsEnd).toBeGreaterThan(scriptsStart);
      expect(build.slice(scriptsStart, scriptsEnd)).toContain(
        'scripts/build/configure-ephemeral-boot.sh',
      );
      expect(build).toContain(
        'shipfox-runner-boot-complete.service /etc/systemd/system/shipfox-runner-boot-complete.service',
      );
      expect(build).toContain('systemctl enable shipfox-runner-env.path');
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails before masking when a boot-policy unit disappears', async () => {
    const script = new URL('../scripts/build/configure-ephemeral-boot.sh', import.meta.url);
    const fixture = await createEphemeralBootFixture();

    try {
      expect(() =>
        execFileSync('sh', [script.pathname], {
          env: {...fixture.environment, SYSTEMCTL_MISSING_UNIT: 'udisks2.service'},
          stdio: 'pipe',
        }),
      ).toThrow('udisks2.service');
      await expect(readFile(fixture.maskLog, 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });

  it('fails the image bake when a higher-precedence journal setting wins', async () => {
    const script = new URL('../scripts/build/configure-ephemeral-boot.sh', import.meta.url);
    const fixture = await createEphemeralBootFixture();

    try {
      expect(() =>
        execFileSync('sh', [script.pathname], {
          env: {...fixture.environment, JOURNAL_EFFECTIVE_STORAGE: 'persistent'},
          stdio: 'pipe',
        }),
      ).toThrow();
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  });
});

async function createEphemeralBootFixture() {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-runner-ephemeral-boot-'));
  const commandDirectory = join(root, 'commands');
  const journalDropIn = join(root, 'etc/systemd/journald.conf.d/shipfox-volatile.conf');
  const maskLog = join(root, 'systemctl-mask.log');
  const catLog = join(root, 'systemctl-cat.log');

  await mkdir(commandDirectory, {recursive: true});
  await writeExecutable(
    join(commandDirectory, 'systemctl'),
    `#!/bin/sh
set -eu
command="$1"
shift
case "$command" in
  cat)
    unit="$1"
    printf '%s\\n' "$unit" >> "$SYSTEMCTL_CAT_LOG"
    if [ "\${SYSTEMCTL_MISSING_UNIT:-}" = "$unit" ]; then
      exit 1
    fi
    ;;
  mask)
    printf '%s\\n' "$*" >> "$SYSTEMCTL_MASK_LOG"
    ;;
  is-enabled)
    printf '%s\\n' masked
    ;;
  *)
    echo "unsupported systemctl command: $command" >&2
    exit 2
    ;;
esac
`,
  );
  await writeExecutable(
    join(commandDirectory, 'install'),
    `#!/bin/sh
set -eu
if [ "$1" != '-d' ]; then
  echo "unsupported install invocation" >&2
  exit 2
fi
shift
if [ "$1" = '-m' ]; then
  shift 2
fi
mkdir -p "$1"
`,
  );
  await writeExecutable(
    join(commandDirectory, 'systemd-analyze'),
    `#!/bin/sh
set -eu
if [ "$1" != 'cat-config' ]; then
  echo "unsupported systemd-analyze invocation" >&2
  exit 2
fi
if [ -n "\${JOURNAL_EFFECTIVE_STORAGE:-}" ]; then
  printf '[Journal]\\nStorage=%s\\nRuntimeMaxUse=64M\\nRateLimitIntervalSec=30s\\nRateLimitBurst=1000\\n' "$JOURNAL_EFFECTIVE_STORAGE"
else
  cat "$SHIPFOX_JOURNAL_DROP_IN"
fi
`,
  );

  return {
    catLog,
    environment: {
      ...process.env,
      PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
      SHIPFOX_JOURNAL_DROP_IN: journalDropIn,
      SYSTEMCTL_CAT_LOG: catLog,
      SYSTEMCTL_MASK_LOG: maskLog,
    },
    journalDropIn,
    maskLog,
    root,
  };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}
