import {DataKeyManager} from '@shipfox/node-envelope-encryption';
import {getDataKey, insertDataKeyIfAbsent} from '#db/index.js';
import {classifyDekAccessError, recordSecretsDekAccess} from '#metrics/instance.js';
import type {KeyProvider} from './key-provider.js';

export class DekManager {
  readonly #manager: DataKeyManager;

  constructor(keyProvider: KeyProvider, options: {maxEntries: number; ttlMs: number}) {
    this.#manager = new DataKeyManager(
      keyProvider,
      {
        async get(workspaceId) {
          const record = await getDataKey(workspaceId);
          return record ? {keyId: workspaceId, ...record} : undefined;
        },
        insertIfAbsent(record) {
          return insertDataKeyIfAbsent({
            workspaceId: record.keyId,
            wrappedDek: record.wrappedDek,
            kekVersion: record.kekVersion,
          });
        },
      },
      options,
    );
  }

  async getPlaintextDek(workspaceId: string): Promise<Buffer> {
    const startedAt = Date.now();
    try {
      const result = await this.#manager.getPlaintextDataKey(workspaceId);
      recordSecretsDekAccess({outcome: result.outcome, durationMs: Date.now() - startedAt});
      return result.dek;
    } catch (error) {
      recordSecretsDekAccess({
        outcome: classifyDekAccessError(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  invalidate(workspaceId: string): void {
    this.#manager.invalidate(workspaceId);
  }
}
