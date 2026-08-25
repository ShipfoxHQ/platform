import {rotateDataKeysWithTelemetry} from '@shipfox/node-envelope-encryption';
import {listDataKeysPage, listDataKeyVersions, updateDataKeyWrapCas} from '#db/index.js';
import {classifyKekRotationError, recordSecretsKekRotation} from '#metrics/instance.js';
import {KekVersionStrandedError} from './errors.js';
import type {KeyProvider} from './key-provider.js';

export interface RotateWorkspaceDataKeysResult {
  rotated: number;
  skipped: number;
}

export interface RotateWorkspaceDataKeysOptions {
  workspaceIds?: string[] | undefined;
}

export function rotateWorkspaceDataKeysWithProvider(
  keyProvider: KeyProvider,
  options: RotateWorkspaceDataKeysOptions = {},
): Promise<RotateWorkspaceDataKeysResult> {
  return rotateDataKeysWithTelemetry({
    keyProvider,
    repository: {
      listUnknownKeyVersions(knownVersions) {
        return listDataKeyVersions(knownVersions, {workspaceIds: options.workspaceIds});
      },
      async listPage(params) {
        const rows = await listDataKeysPage({
          afterWorkspaceId: params.afterKeyId,
          limit: params.limit,
          workspaceIds: options.workspaceIds,
        });
        return rows.map((row) => ({keyId: row.workspaceId, ...row}));
      },
      updateWrapCas(params) {
        return updateDataKeyWrapCas({
          workspaceId: params.keyId,
          oldKekVersion: params.oldKekVersion,
          wrappedDek: params.wrappedDek,
          kekVersion: params.kekVersion,
        });
      },
    },
    record: recordSecretsKekRotation,
    classifyError: classifyKekRotationError,
    strandedError: (keyVersion) => new KekVersionStrandedError(keyVersion),
  });
}
