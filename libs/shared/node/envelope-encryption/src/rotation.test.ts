import crypto from 'node:crypto';
import {
  createLocalKeyProvider,
  type DataKeyRotationRepository,
  DataKeyVersionStrandedError,
  type RotatableDataKeyRecord,
  rotateDataKeys,
  rotateDataKeysWithTelemetry,
} from './index.js';

class MemoryRotationRepository implements DataKeyRotationRepository {
  constructor(readonly records: RotatableDataKeyRecord[]) {}

  listUnknownKeyVersions(knownVersions: string[]): Promise<string[]> {
    return Promise.resolve(
      [...new Set(this.records.map((row) => row.kekVersion))].filter(
        (version) => !knownVersions.includes(version),
      ),
    );
  }

  listPage(params: {
    afterKeyId?: string | undefined;
    limit: number;
  }): Promise<RotatableDataKeyRecord[]> {
    return Promise.resolve(
      this.records
        .filter((row) => !params.afterKeyId || row.keyId > params.afterKeyId)
        .sort((left, right) => left.keyId.localeCompare(right.keyId))
        .slice(0, params.limit),
    );
  }

  updateWrapCas(params: {
    keyId: string;
    oldKekVersion: string;
    wrappedDek: string;
    kekVersion: string;
  }): Promise<boolean> {
    const row = this.records.find((candidate) => candidate.keyId === params.keyId);
    if (!row || row.kekVersion !== params.oldKekVersion) return Promise.resolve(false);
    row.wrappedDek = params.wrappedDek;
    row.kekVersion = params.kekVersion;
    return Promise.resolve(true);
  }
}

describe('data key rotation', () => {
  test('rewraps previous keys and is idempotent', async () => {
    const previousKek = crypto.randomBytes(32);
    const currentKek = crypto.randomBytes(32);
    const previousProvider = createLocalKeyProvider({
      currentKek: previousKek,
      keyVersionDomain: 'test-domain',
    });
    const plaintextDek = crypto.randomBytes(32);
    const wrapped = previousProvider.wrapDek('workspace-1', plaintextDek);
    const repository = new MemoryRotationRepository([{keyId: 'workspace-1', ...wrapped}]);
    const provider = createLocalKeyProvider({
      currentKek,
      previousKek,
      keyVersionDomain: 'test-domain',
    });

    expect(await rotateDataKeys({keyProvider: provider, repository})).toEqual({
      rotated: 1,
      skipped: 0,
      skippedCurrent: 0,
      skippedRace: 0,
    });
    expect(
      provider.unwrapDek(
        'workspace-1',
        repository.records[0]?.wrappedDek ?? '',
        provider.currentKeyVersion,
      ),
    ).toEqual(plaintextDek);
    expect(await rotateDataKeys({keyProvider: provider, repository})).toEqual({
      rotated: 0,
      skipped: 1,
      skippedCurrent: 1,
      skippedRace: 0,
    });
  });

  test('fails before rotation when a key version is unknown', async () => {
    const provider = createLocalKeyProvider({
      currentKek: crypto.randomBytes(32),
      keyVersionDomain: 'test-domain',
    });
    const repository = new MemoryRotationRepository([
      {keyId: 'workspace-1', wrappedDek: 'v1:AAAA', kekVersion: 'unknown'},
    ]);

    await expect(rotateDataKeys({keyProvider: provider, repository})).rejects.toThrow(
      DataKeyVersionStrandedError,
    );
  });

  test('rejects a pageSize that is not a positive integer', async () => {
    const provider = createLocalKeyProvider({
      currentKek: crypto.randomBytes(32),
      keyVersionDomain: 'test-domain',
    });
    const repository = new MemoryRotationRepository([]);

    for (const pageSize of [0, -1, 1.5, Number.NaN]) {
      await expect(rotateDataKeys({keyProvider: provider, repository, pageSize})).rejects.toThrow(
        RangeError,
      );
    }
  });

  test('rotateDataKeysWithTelemetry records outcomes, duration, and maps stranded errors', async () => {
    const previousKek = crypto.randomBytes(32);
    const currentKek = crypto.randomBytes(32);
    const previousProvider = createLocalKeyProvider({
      currentKek: previousKek,
      keyVersionDomain: 'test-domain',
    });
    const plaintextDek = crypto.randomBytes(32);
    const wrapped = previousProvider.wrapDek('workspace-1', plaintextDek);
    const repository = new MemoryRotationRepository([{keyId: 'workspace-1', ...wrapped}]);
    const provider = createLocalKeyProvider({
      currentKek,
      previousKek,
      keyVersionDomain: 'test-domain',
    });

    const recorded: Array<{
      outcome: string;
      count?: number | undefined;
      durationMs?: number | undefined;
    }> = [];
    const result = await rotateDataKeysWithTelemetry({
      keyProvider: provider,
      repository,
      record: (params) => recorded.push(params),
      classifyError: () => 'failure',
      strandedError: (keyVersion) => new Error(`stranded: ${keyVersion}`),
    });

    expect(result).toEqual({rotated: 1, skipped: 0});
    expect(recorded.map((entry) => entry.outcome)).toEqual([
      'rotated',
      'skipped_current',
      'skipped_race',
      'rotated',
    ]);
    expect(recorded[0]).toMatchObject({count: 1});
    expect(recorded[3]).toMatchObject({count: 0, durationMs: expect.any(Number)});

    const stranded = new Error('domain stranded');
    const strandedRepository = new MemoryRotationRepository([
      {keyId: 'workspace-2', wrappedDek: 'v1:AAAA', kekVersion: 'unknown'},
    ]);
    await expect(
      rotateDataKeysWithTelemetry({
        keyProvider: provider,
        repository: strandedRepository,
        record: () => undefined,
        classifyError: () => 'stranded',
        strandedError: () => stranded,
      }),
    ).rejects.toThrow('domain stranded');
  });
});
