import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  createRunnerImageCandidateManifest,
  createRunnerImageReleaseManifest,
  mergeRunnerImageCandidateManifests,
  mergeRunnerImageReleaseManifests,
  runRunnerImageCatalogCli,
} from '#catalog.js';

const revision = '0123456789abcdef0123456789abcdef01234567';

function input(architecture: 'amd64' | 'arm64' = 'amd64') {
  return {
    sourceRepository: 'https://github.com/ShipfoxHQ/shipfox',
    revision,
    build: {
      system: 'github-actions',
      id: '123456789',
      number: 42,
      attempt: 1,
      url: 'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
      createdAt: '2026-07-19T10:00:00Z',
    },
    images: [
      {
        amiId: architecture === 'amd64' ? 'ami-0123abc456def7890' : 'ami-0fedcba9876543210',
        architecture,
        buildNumber: '42',
        createdAt: '2026-07-19T10:15:00Z',
        encrypted: true,
        imageOs: 'ubuntu24',
        region: 'eu-central-1',
        runnerVersion: '0.1.0',
        sourceAmi: 'ami-0123abc456def7890',
      },
    ],
  };
}

function candidate(architecture: 'amd64' | 'arm64') {
  return {
    amiId: architecture === 'amd64' ? 'ami-0123abc456def7890' : 'ami-0fedcba9876543210',
    architecture,
    candidateId: `main-${revision}`,
    createdAt: '2026-07-19T10:15:00.000Z',
    expiresAt: '2026-08-02T10:15:00.000Z',
    imageOs: 'ubuntu24',
    owner: '123456789012',
    region: 'eu-central-1',
    revision,
    status: 'built' as const,
  };
}

function candidateManifestInput() {
  return {
    sourceRepository: 'https://github.com/ShipfoxHQ/shipfox',
    revision,
    build: {
      system: 'github-actions',
      id: '123456789',
      number: 42,
      attempt: 1,
      url: 'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
      createdAt: '2026-07-19T10:00:00Z',
    },
  };
}

describe('runner image candidate manifests', () => {
  it('merges both architecture results into a strict immutable candidate manifest', () => {
    const manifest = mergeRunnerImageCandidateManifests(
      [candidate('arm64'), candidate('amd64')],
      candidateManifestInput(),
    );

    expect(manifest).toMatchObject({
      kind: 'shipfox.runner-image-candidate',
      apiVersion: 'v1',
      source: {revision},
      build: {createdAt: '2026-07-19T10:00:00.000Z'},
      images: [
        expect.objectContaining({architecture: 'amd64', encrypted: true}),
        expect.objectContaining({architecture: 'arm64', encrypted: true}),
      ],
    });
  });

  it('rejects a candidate result from a different source revision', () => {
    const mismatched = {
      ...candidate('arm64'),
      revision: 'fedcba9876543210fedcba9876543210fedcba98',
    };

    expect(() =>
      mergeRunnerImageCandidateManifests(
        [candidate('amd64'), mismatched],
        candidateManifestInput(),
      ),
    ).toThrow('same source revision');
  });

  it('requires both architectures', () => {
    expect(() =>
      createRunnerImageCandidateManifest({
        ...candidateManifestInput(),
        images: [candidate('amd64')],
      }),
    ).toThrow('Invalid runner image candidate manifest');
  });

  it('rejects an empty candidate list', () => {
    expect(() => mergeRunnerImageCandidateManifests([], candidateManifestInput())).toThrow(
      'At least one runner image candidate is required.',
    );
  });
});

describe('createRunnerImageReleaseManifest', () => {
  it('creates a strict AMI release catalog entry', () => {
    const manifest = createRunnerImageReleaseManifest(input());

    expect(manifest).toMatchObject({
      kind: 'shipfox.runner-image-release',
      apiVersion: 'v1',
      source: {revision},
      build: {createdAt: '2026-07-19T10:00:00.000Z'},
      images: [{architecture: 'amd64', createdAt: '2026-07-19T10:15:00.000Z'}],
    });
  });

  it('rejects extra catalog fields', () => {
    const baseInput = input();
    const image = baseInput.images[0];
    if (!image) throw new Error('Expected a runner image catalog entry.');
    const releaseInput = {
      ...baseInput,
      images: [{...image, unexpected: 'value'}],
    };

    expect(() => createRunnerImageReleaseManifest(releaseInput)).toThrow(
      'Invalid runner image release manifest',
    );
  });

  it('rejects missing catalog fields', () => {
    const source = input();
    const image = source.images[0];
    if (!image) throw new Error('Expected a runner image catalog entry.');
    const {sourceAmi: _sourceAmi, ...incompleteImage} = image;
    const releaseInput = {...source, images: [incompleteImage]};

    expect(() =>
      createRunnerImageReleaseManifest(
        releaseInput as unknown as Parameters<typeof createRunnerImageReleaseManifest>[0],
      ),
    ).toThrow('Invalid runner image release manifest');
  });
});

describe('mergeRunnerImageReleaseManifests', () => {
  it('combines one fragment per architecture into a stable release catalog', () => {
    const merged = mergeRunnerImageReleaseManifests([
      createRunnerImageReleaseManifest(input('arm64')),
      createRunnerImageReleaseManifest(input('amd64')),
    ]);

    expect(merged.images.map((image) => image.architecture)).toEqual(['amd64', 'arm64']);
  });

  it.each([
    {
      name: 'source revisions differ',
      fragments: () => {
        const arm64 = input('arm64');
        arm64.revision = 'fedcba9876543210fedcba9876543210fedcba98';
        return [
          createRunnerImageReleaseManifest(input('amd64')),
          createRunnerImageReleaseManifest(arm64),
        ];
      },
      error: 'Runner image release fragments must describe the same source revision.',
    },
    {
      name: 'architectures overlap',
      fragments: () => [
        createRunnerImageReleaseManifest(input('amd64')),
        createRunnerImageReleaseManifest(input('amd64')),
      ],
      error: 'Runner image release has duplicate amd64 artifacts.',
    },
  ])('rejects fragments when $name', ({fragments, error}) => {
    expect(() => mergeRunnerImageReleaseManifests(fragments())).toThrow(error);
  });
});

describe('runner-image-catalog CLI', () => {
  it('creates a schema-valid release fragment from Packer output', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shipfox-runner-image-catalog-'));
    const packerManifestPath = join(tempDir, 'packer-manifest.json');
    const catalogPath = join(tempDir, 'runner-image-release.json');
    await writeFile(
      packerManifestPath,
      JSON.stringify({
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
              encrypted: 'true',
              image_os: 'ubuntu24',
              revision,
              runner_version: '0.1.0',
            },
          },
        ],
      }),
    );

    try {
      const args = [
        'create',
        '--packer-manifest',
        packerManifestPath,
        '--source-repository',
        'https://github.com/ShipfoxHQ/shipfox',
        '--revision',
        revision,
        '--build-system',
        'github-actions',
        '--build-id',
        '123456789',
        '--build-number',
        '42',
        '--build-attempt',
        '1',
        '--build-created-at',
        '2026-07-19T10:00:00Z',
        '--build-url',
        'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
        '--source-ami',
        'ami-0fedcba9876543210',
        '--output',
        catalogPath,
      ];
      runRunnerImageCatalogCli(args);

      const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

      expect(catalog.images).toEqual([
        expect.objectContaining({
          amiId: 'ami-0123abc456def7890',
          sourceAmi: 'ami-0fedcba9876543210',
        }),
      ]);
      expect(() =>
        runRunnerImageCatalogCli(
          args.map((value) =>
            value === revision ? 'fedcba9876543210fedcba9876543210fedcba98' : value,
          ),
        ),
      ).toThrow('Packer manifest revision does not match --revision.');
      expect(() =>
        runRunnerImageCatalogCli(args.map((value) => (value === '42' ? '43' : value))),
      ).toThrow('Packer manifest build_number does not match --build-number.');
      expect(() =>
        runRunnerImageCatalogCli(args.map((value) => (value === '1' ? '2' : value))),
      ).toThrow('Packer manifest build_attempt does not match --build-attempt.');
    } finally {
      await rm(tempDir, {force: true, recursive: true});
    }
  });

  it('merges catalog fragment files through the CLI', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shipfox-runner-image-catalog-'));
    const amd64Path = join(tempDir, 'amd64.json');
    const arm64Path = join(tempDir, 'arm64.json');
    const mergedPath = join(tempDir, 'merged.json');
    await writeFile(amd64Path, JSON.stringify(createRunnerImageReleaseManifest(input('amd64'))));
    await writeFile(arm64Path, JSON.stringify(createRunnerImageReleaseManifest(input('arm64'))));

    try {
      runRunnerImageCatalogCli(['merge', '--output', mergedPath, amd64Path, arm64Path]);

      const catalog = JSON.parse(await readFile(mergedPath, 'utf8'));

      expect(catalog.images.map((image: {architecture: string}) => image.architecture)).toEqual([
        'amd64',
        'arm64',
      ]);
    } finally {
      await rm(tempDir, {force: true, recursive: true});
    }
  });

  it('merges candidate results through the CLI', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shipfox-runner-image-candidate-'));
    const amd64Path = join(tempDir, 'amd64.json');
    const arm64Path = join(tempDir, 'arm64.json');
    const mergedPath = join(tempDir, 'candidate.json');
    await writeFile(amd64Path, JSON.stringify(candidate('amd64')));
    await writeFile(arm64Path, JSON.stringify(candidate('arm64')));

    try {
      runRunnerImageCatalogCli([
        'merge-candidates',
        '--candidate',
        amd64Path,
        '--candidate',
        arm64Path,
        '--source-repository',
        'https://github.com/ShipfoxHQ/shipfox',
        '--revision',
        revision,
        '--build-system',
        'github-actions',
        '--build-id',
        '123456789',
        '--build-number',
        '42',
        '--build-attempt',
        '1',
        '--build-created-at',
        '2026-07-19T10:00:00Z',
        '--build-url',
        'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
        '--output',
        mergedPath,
      ]);

      const manifest = JSON.parse(await readFile(mergedPath, 'utf8'));

      expect(manifest.kind).toBe('shipfox.runner-image-candidate');
      expect(manifest.images.map((image: {architecture: string}) => image.architecture)).toEqual([
        'amd64',
        'arm64',
      ]);
    } finally {
      await rm(tempDir, {force: true, recursive: true});
    }
  });

  it('requires both architecture results to merge candidates', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shipfox-runner-image-candidate-'));
    const amd64Path = join(tempDir, 'amd64.json');
    await writeFile(amd64Path, JSON.stringify(candidate('amd64')));

    try {
      expect(() =>
        runRunnerImageCatalogCli([
          'merge-candidates',
          '--candidate',
          amd64Path,
          '--source-repository',
          'https://github.com/ShipfoxHQ/shipfox',
          '--revision',
          revision,
          '--build-system',
          'github-actions',
          '--build-id',
          '123456789',
          '--build-number',
          '42',
          '--build-attempt',
          '1',
          '--build-created-at',
          '2026-07-19T10:00:00Z',
          '--build-url',
          'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
          '--output',
          join(tempDir, 'candidate.json'),
        ]),
      ).toThrow('runner-image-catalog merge-candidates requires both architecture results.');
    } finally {
      await rm(tempDir, {force: true, recursive: true});
    }
  });

  it('rejects a candidate result file missing required metadata', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shipfox-runner-image-candidate-'));
    const amd64Path = join(tempDir, 'amd64.json');
    const arm64Path = join(tempDir, 'arm64.json');
    const {owner: _owner, ...incompleteCandidate} = candidate('amd64');
    await writeFile(amd64Path, JSON.stringify(incompleteCandidate));
    await writeFile(arm64Path, JSON.stringify(candidate('arm64')));

    try {
      expect(() =>
        runRunnerImageCatalogCli([
          'merge-candidates',
          '--candidate',
          amd64Path,
          '--candidate',
          arm64Path,
          '--source-repository',
          'https://github.com/ShipfoxHQ/shipfox',
          '--revision',
          revision,
          '--build-system',
          'github-actions',
          '--build-id',
          '123456789',
          '--build-number',
          '42',
          '--build-attempt',
          '1',
          '--build-created-at',
          '2026-07-19T10:00:00Z',
          '--build-url',
          'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
          '--output',
          join(tempDir, 'candidate.json'),
        ]),
      ).toThrow(`Runner image candidate ${amd64Path} is missing required metadata.`);
    } finally {
      await rm(tempDir, {force: true, recursive: true});
    }
  });
});
