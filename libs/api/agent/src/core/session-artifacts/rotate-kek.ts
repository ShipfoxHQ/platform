import {rotateDataKeysWithTelemetry} from '@shipfox/node-envelope-encryption';
import {
  listSessionDataKeysPage,
  listSessionDataKeyVersions,
  updateSessionDataKeyWrapCas,
} from '#db/index.js';
import {classifySessionKekRotationError, recordSessionKekRotation} from '#metrics/instance.js';
import {AgentSessionKekVersionStrandedError} from '../errors.js';
import type {SessionKeyProvider} from './key-provider.js';

export interface RotateAgentSessionDataKeysResult {
  rotated: number;
  skipped: number;
}

export interface RotateAgentSessionDataKeysOptions {
  workspaceIds?: string[] | undefined;
}

export function rotateAgentSessionDataKeysWithProvider(
  keyProvider: SessionKeyProvider,
  options: RotateAgentSessionDataKeysOptions = {},
): Promise<RotateAgentSessionDataKeysResult> {
  return rotateDataKeysWithTelemetry({
    keyProvider,
    repository: {
      listUnknownKeyVersions(knownVersions) {
        return listSessionDataKeyVersions(knownVersions, {
          workspaceIds: options.workspaceIds,
        });
      },
      async listPage(params) {
        const rows = await listSessionDataKeysPage({
          afterWorkspaceId: params.afterKeyId,
          limit: params.limit,
          workspaceIds: options.workspaceIds,
        });
        return rows.map((row) => ({keyId: row.workspaceId, ...row}));
      },
      updateWrapCas(params) {
        return updateSessionDataKeyWrapCas({
          workspaceId: params.keyId,
          oldKekVersion: params.oldKekVersion,
          wrappedDek: params.wrappedDek,
          kekVersion: params.kekVersion,
        });
      },
    },
    record: recordSessionKekRotation,
    classifyError: classifySessionKekRotationError,
    strandedError: (keyVersion) => new AgentSessionKekVersionStrandedError(keyVersion),
  });
}
