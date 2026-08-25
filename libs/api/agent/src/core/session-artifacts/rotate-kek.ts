import {DataKeyVersionStrandedError, rotateDataKeys} from '@shipfox/node-envelope-encryption';
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

export async function rotateAgentSessionDataKeysWithProvider(
  keyProvider: SessionKeyProvider,
  options: RotateAgentSessionDataKeysOptions = {},
): Promise<RotateAgentSessionDataKeysResult> {
  const startedAt = Date.now();
  try {
    const result = await rotateDataKeys({
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
    });

    recordSessionKekRotation({outcome: 'rotated', count: result.rotated});
    recordSessionKekRotation({outcome: 'skipped_current', count: result.skippedCurrent});
    recordSessionKekRotation({outcome: 'skipped_race', count: result.skippedRace});
    recordSessionKekRotation({
      outcome: rotationDurationOutcome(result),
      count: 0,
      durationMs: Date.now() - startedAt,
    });
    return {rotated: result.rotated, skipped: result.skipped};
  } catch (error) {
    const domainError =
      error instanceof DataKeyVersionStrandedError
        ? new AgentSessionKekVersionStrandedError(error.keyVersion)
        : error;
    recordSessionKekRotation({
      outcome: classifySessionKekRotationError(domainError),
      durationMs: Date.now() - startedAt,
    });
    throw domainError;
  }
}

function rotationDurationOutcome(params: {
  rotated: number;
  skippedCurrent: number;
  skippedRace: number;
}) {
  if (params.rotated > 0) return 'rotated';
  if (params.skippedRace > 0) return 'skipped_race';
  if (params.skippedCurrent === 0) return 'none';
  return 'skipped_current';
}
