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
  const pageSize = params.pageSize ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`pageSize must be a positive integer, got ${params.pageSize}`);
  }

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
      limit: pageSize,
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

export interface RotateDataKeysWithTelemetryParams<TOutcome extends string> {
  keyProvider: EnvelopeKeyProvider;
  repository: DataKeyRotationRepository;
  pageSize?: number | undefined;
  /**
   * Records rotation telemetry. Called with the same outcome labels the module
   * already emits; a `durationMs`-only call records the rotation duration.
   */
  record: (params: {
    outcome: TOutcome;
    count?: number | undefined;
    durationMs?: number | undefined;
  }) => void;
  /** Maps a thrown error to the module's rotation outcome label. */
  classifyError: (error: unknown) => TOutcome;
  /** Maps the shared stranded-key error to the module's domain error. */
  strandedError: (keyVersion: string) => unknown;
}

export interface RotateDataKeysWithTelemetryResult {
  rotated: number;
  skipped: number;
}

/**
 * Runs the shared `rotateDataKeys` sweep with timing, per-outcome telemetry,
 * and domain error mapping, so store wrappers (Secrets, Agent sessions) stay
 * free of duplicated orchestration and cannot drift apart.
 */
export async function rotateDataKeysWithTelemetry<TOutcome extends string>(
  params: RotateDataKeysWithTelemetryParams<TOutcome>,
): Promise<RotateDataKeysWithTelemetryResult> {
  const startedAt = Date.now();
  try {
    const result = await rotateDataKeys({
      keyProvider: params.keyProvider,
      repository: params.repository,
      pageSize: params.pageSize,
    });

    params.record({outcome: 'rotated' as TOutcome, count: result.rotated});
    params.record({outcome: 'skipped_current' as TOutcome, count: result.skippedCurrent});
    params.record({outcome: 'skipped_race' as TOutcome, count: result.skippedRace});
    params.record({
      outcome: rotationDurationOutcome(result) as TOutcome,
      count: 0,
      durationMs: Date.now() - startedAt,
    });
    return {rotated: result.rotated, skipped: result.skipped};
  } catch (error) {
    const domainError =
      error instanceof DataKeyVersionStrandedError ? params.strandedError(error.keyVersion) : error;
    params.record({
      outcome: params.classifyError(domainError),
      durationMs: Date.now() - startedAt,
    });
    throw domainError;
  }
}

function rotationDurationOutcome(params: {
  rotated: number;
  skippedCurrent: number;
  skippedRace: number;
}): 'rotated' | 'skipped_race' | 'none' | 'skipped_current' {
  if (params.rotated > 0) return 'rotated';
  if (params.skippedRace > 0) return 'skipped_race';
  if (params.skippedCurrent === 0) return 'none';
  return 'skipped_current';
}
