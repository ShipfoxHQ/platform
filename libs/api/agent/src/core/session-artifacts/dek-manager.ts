import {DataKeyManager} from '@shipfox/node-envelope-encryption';
import {getSessionDataKey, insertSessionDataKeyIfAbsent} from '#db/data-keys.js';
import type {SessionKeyProvider} from './key-provider.js';

export class SessionDekManager {
  readonly #manager: DataKeyManager;

  constructor(keyProvider: SessionKeyProvider, options: {maxEntries: number; ttlMs: number}) {
    this.#manager = new DataKeyManager(
      keyProvider,
      {
        async get(workspaceId) {
          const record = await getSessionDataKey(workspaceId);
          return record ? {keyId: workspaceId, ...record} : undefined;
        },
        insertIfAbsent(record) {
          return insertSessionDataKeyIfAbsent({
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
    const result = await this.#manager.getPlaintextDataKey(workspaceId);
    return result.dek;
  }

  invalidate(workspaceId: string): void {
    this.#manager.invalidate(workspaceId);
  }
}
