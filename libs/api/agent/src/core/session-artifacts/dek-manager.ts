import crypto from 'node:crypto';
import {getSessionDataKey, insertSessionDataKeyIfAbsent} from '#db/data-keys.js';
import type {SessionKeyProvider} from './key-provider.js';

const DEK_BYTES = 32;

/**
 * Plaintext per-workspace session DEKs live in memory by design so hot commit
 * and read paths avoid unwrapping on every access, mirroring the secrets
 * module's `DekManager` residency model: bounded by LRU size and lazy TTL
 * instead of pretending wipes are a complete mitigation.
 */
export class SessionDekManager {
  readonly #cache = new Map<string, {dek: Buffer; expiresAt: number}>();
  readonly #keyProvider: SessionKeyProvider;
  readonly #options: {maxEntries: number; ttlMs: number};

  constructor(keyProvider: SessionKeyProvider, options: {maxEntries: number; ttlMs: number}) {
    this.#keyProvider = keyProvider;
    this.#options = options;
  }

  async getPlaintextDek(workspaceId: string): Promise<Buffer> {
    const cached = this.#cache.get(workspaceId);
    if (cached && cached.expiresAt > Date.now()) {
      this.#cache.delete(workspaceId);
      this.#cache.set(workspaceId, cached);
      return Buffer.from(cached.dek);
    }
    if (cached) this.#cache.delete(workspaceId);

    const existing = await getSessionDataKey(workspaceId);
    if (existing) {
      const dek = this.#keyProvider.unwrapDek(
        workspaceId,
        existing.wrappedDek,
        existing.kekVersion,
      );
      this.#set(workspaceId, dek);
      return Buffer.from(dek);
    }

    const generatedDek = crypto.randomBytes(DEK_BYTES);
    const wrapped = this.#keyProvider.wrapDek(workspaceId, generatedDek);
    await insertSessionDataKeyIfAbsent({
      workspaceId,
      wrappedDek: wrapped.wrappedDek,
      kekVersion: wrapped.kekVersion,
    });

    // The DEK row commits before artifact writes. If concurrent first-use inserts race,
    // the primary key decides the winner and every caller re-reads the persisted row.
    const persisted = await getSessionDataKey(workspaceId);
    if (!persisted) {
      throw new Error(`Session data key was not persisted for workspace ${workspaceId}`);
    }
    const dek = this.#keyProvider.unwrapDek(
      workspaceId,
      persisted.wrappedDek,
      persisted.kekVersion,
    );
    this.#set(workspaceId, dek);
    return Buffer.from(dek);
  }

  #set(workspaceId: string, dek: Buffer): void {
    this.#cache.set(workspaceId, {
      dek: Buffer.from(dek),
      expiresAt: Date.now() + this.#options.ttlMs,
    });
    while (this.#cache.size > this.#options.maxEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#cache.delete(oldest);
    }
  }
}
