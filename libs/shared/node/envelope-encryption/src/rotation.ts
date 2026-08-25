import {DataKeyVersionStrandedError} from './errors.js';
import type {EnvelopeKeyProvider} from './key-provider.js';

export interface RotatableDataKeyRecord {
  keyId: string;
  wrappedDek: string;
  kekVersion: string;
}

export interface DataKeyRotationRepository {
  listUnknownKeyVersions(knownVersions: string[]): Promise<string[]>;
  listPage(params: {
    afterKeyId?: string | undefined;
    limit: number;
  }): Promise<RotatableDataKeyRecord[]>;
  updateWrapCas(params: {
    keyId: string;
    oldKekVersion: string;
    wrappedDek: string;
    kekVersion: string;
  }): Promise<boolean>;
}

export interface RotateDataKeysResult {
  rotated: number;
  skipped: number;
  skippedCurrent: number;
  skippedRace: number;
}

export async function rotateDataKeys(params: {
  keyProvider: EnvelopeKeyProvider;
  repository: DataKeyRotationRepository;
  pageSize?: number | undefined;
}): Promise<RotateDataKeysResult> {
  const knownVersions = [
    params.keyProvider.currentKeyVersion,
    params.keyProvider.previousKeyVersion,
  ].filter((version): version is string => Boolean(version));
  const unknownVersions = await params.repository.listUnknownKeyVersions(knownVersions);
  if (unknownVersions.length > 0) {
    throw new DataKeyVersionStrandedError(unknownVersions[0] as string);
  }

  let rotated = 0;
  let skippedCurrent = 0;
  let skippedRace = 0;
  let afterKeyId: string | undefined;

  while (true) {
    const page = await params.repository.listPage({
      afterKeyId,
      limit: params.pageSize ?? 100,
    });
    if (page.length === 0) break;

    for (const row of page) {
      afterKeyId = row.keyId;
      if (row.kekVersion === params.keyProvider.currentKeyVersion) {
        skippedCurrent += 1;
        continue;
      }

      const plaintextDek = params.keyProvider.unwrapDek(row.keyId, row.wrappedDek, row.kekVersion);
      try {
        const wrapped = params.keyProvider.wrapDek(row.keyId, plaintextDek);
        const updated = await params.repository.updateWrapCas({
          keyId: row.keyId,
          oldKekVersion: row.kekVersion,
          wrappedDek: wrapped.wrappedDek,
          kekVersion: wrapped.kekVersion,
        });
        if (updated) rotated += 1;
        else skippedRace += 1;
      } finally {
        plaintextDek.fill(0);
      }
    }
  }

  return {
    rotated,
    skipped: skippedCurrent + skippedRace,
    skippedCurrent,
    skippedRace,
  };
}
