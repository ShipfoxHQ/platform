import crypto from 'node:crypto';
import type {EnvelopeKeyProvider} from './key-provider.js';

const DEK_BYTES = 32;

export interface DataKeyRecord {
  keyId: string;
  wrappedDek: string;
  kekVersion: string;
}

export interface DataKeyRepository {
  get(keyId: string): Promise<DataKeyRecord | undefined>;
  insertIfAbsent(record: DataKeyRecord): Promise<boolean>;
}

export type DataKeyAccessOutcome = 'cache_hit' | 'cache_expired' | 'db_unwrapped' | 'generated';

export interface PlaintextDataKey {
  dek: Buffer;
  outcome: DataKeyAccessOutcome;
}

/**
 * Keeps plaintext DEKs in a bounded LRU cache. Buffer wiping is best effort;
 * Node does not guarantee complete zeroization of copied or moved memory.
 */
export class DataKeyManager {
  readonly #cache = new Map<string, {dek: Buffer; expiresAt: number}>();
  readonly #keyProvider: EnvelopeKeyProvider;
  readonly #repository: DataKeyRepository;
  readonly #options: {maxEntries: number; ttlMs: number};
  readonly #sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    keyProvider: EnvelopeKeyProvider,
    repository: DataKeyRepository,
    options: {maxEntries: number; ttlMs: number},
  ) {
    this.#keyProvider = keyProvider;
    this.#repository = repository;
    this.#options = options;
    // Periodically wipe expired plaintext keys even when no new request touches
    // them, so the TTL also bounds plaintext retention for idle workspaces.
    const sweepIntervalMs = Math.max(1_000, Math.floor(this.#options.ttlMs / 2));
    this.#sweepTimer = setInterval(() => this.#sweepExpired(), sweepIntervalMs);
    this.#sweepTimer.unref();
  }

  async getPlaintextDataKey(keyId: string): Promise<PlaintextDataKey> {
    const cached = this.#cache.get(keyId);
    if (cached && cached.expiresAt > Date.now()) {
      this.#cache.delete(keyId);
      this.#cache.set(keyId, cached);
      return {dek: Buffer.from(cached.dek), outcome: 'cache_hit'};
    }
    const hadExpiredCache = Boolean(cached);
    if (cached) this.#delete(keyId);

    const existing = await this.#repository.get(keyId);
    if (existing) {
      const dek = this.#keyProvider.unwrapDek(keyId, existing.wrappedDek, existing.kekVersion);
      try {
        this.#set(keyId, dek);
        return {
          dek: Buffer.from(dek),
          outcome: hadExpiredCache ? 'cache_expired' : 'db_unwrapped',
        };
      } finally {
        dek.fill(0);
      }
    }

    const generatedDek = crypto.randomBytes(DEK_BYTES);
    let inserted = false;
    try {
      const wrapped = this.#keyProvider.wrapDek(keyId, generatedDek);
      inserted = await this.#repository.insertIfAbsent({
        keyId,
        wrappedDek: wrapped.wrappedDek,
        kekVersion: wrapped.kekVersion,
      });
    } finally {
      generatedDek.fill(0);
    }

    const persisted = await this.#repository.get(keyId);
    if (!persisted) throw new Error(`Data key was not persisted for ${keyId}`);
    const dek = this.#keyProvider.unwrapDek(keyId, persisted.wrappedDek, persisted.kekVersion);
    try {
      this.#set(keyId, dek);
      return {dek: Buffer.from(dek), outcome: inserted ? 'generated' : 'db_unwrapped'};
    } finally {
      dek.fill(0);
    }
  }

  invalidate(keyId: string): void {
    this.#delete(keyId);
  }

  /** Evicts every cached plaintext key; the expiration sweeper keeps running. */
  clear(): void {
    for (const keyId of this.#cache.keys()) this.#delete(keyId);
  }

  /**
   * Releases the manager: evicts cached plaintext keys and stops the periodic
   * expiration sweeper. After `dispose()`, the manager must not be reused.
   */
  dispose(): void {
    clearInterval(this.#sweepTimer);
    for (const keyId of this.#cache.keys()) this.#delete(keyId);
  }

  #sweepExpired(): void {
    const now = Date.now();
    for (const [keyId, entry] of this.#cache) {
      if (entry.expiresAt <= now) this.#delete(keyId);
    }
  }

  #set(keyId: string, dek: Buffer): void {
    this.#delete(keyId);
    this.#cache.set(keyId, {dek: Buffer.from(dek), expiresAt: Date.now() + this.#options.ttlMs});
    while (this.#cache.size > this.#options.maxEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#delete(oldest);
    }
  }

  #delete(keyId: string): void {
    const cached = this.#cache.get(keyId);
    if (cached) cached.dek.fill(0);
    this.#cache.delete(keyId);
  }
}
