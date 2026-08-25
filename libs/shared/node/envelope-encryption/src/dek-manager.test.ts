import crypto from 'node:crypto';
import {
  createLocalKeyProvider,
  DataKeyManager,
  type DataKeyRecord,
  type DataKeyRepository,
} from './index.js';

class MemoryDataKeyRepository implements DataKeyRepository {
  readonly records = new Map<string, DataKeyRecord>();
  insertAttempts = 0;

  get(keyId: string): Promise<DataKeyRecord | undefined> {
    return Promise.resolve(this.records.get(keyId));
  }

  insertIfAbsent(record: DataKeyRecord): Promise<boolean> {
    this.insertAttempts += 1;
    if (this.records.has(record.keyId)) return Promise.resolve(false);
    this.records.set(record.keyId, record);
    return Promise.resolve(true);
  }
}

describe('data key manager', () => {
  test('generates once, caches plaintext, and returns defensive copies', async () => {
    const repository = new MemoryDataKeyRepository();
    const provider = createLocalKeyProvider({
      currentKek: crypto.randomBytes(32),
      keyVersionDomain: 'test-domain',
    });
    const manager = new DataKeyManager(provider, repository, {maxEntries: 10, ttlMs: 60_000});

    const first = await manager.getPlaintextDataKey('workspace-1');
    expect(first.outcome).toBe('generated');
    first.dek.fill(0);

    const second = await manager.getPlaintextDataKey('workspace-1');
    expect(second.outcome).toBe('cache_hit');
    expect(second.dek).not.toEqual(first.dek);
    expect(repository.insertAttempts).toBe(1);
  });

  test('re-reads the persisted winner after a first-use race', async () => {
    const provider = createLocalKeyProvider({
      currentKek: crypto.randomBytes(32),
      keyVersionDomain: 'test-domain',
    });
    const winningDek = crypto.randomBytes(32);
    const winningWrap = provider.wrapDek('workspace-1', winningDek);
    let reads = 0;
    const repository: DataKeyRepository = {
      get(keyId) {
        reads += 1;
        return Promise.resolve(reads === 1 ? undefined : {keyId, ...winningWrap});
      },
      insertIfAbsent() {
        return Promise.resolve(false);
      },
    };
    const manager = new DataKeyManager(provider, repository, {maxEntries: 10, ttlMs: 60_000});

    const result = await manager.getPlaintextDataKey('workspace-1');
    expect(result.outcome).toBe('db_unwrapped');
    expect(result.dek).toEqual(winningDek);
  });

  test('invalidates cached plaintext keys', async () => {
    const repository = new MemoryDataKeyRepository();
    const provider = createLocalKeyProvider({
      currentKek: crypto.randomBytes(32),
      keyVersionDomain: 'test-domain',
    });
    const manager = new DataKeyManager(provider, repository, {maxEntries: 10, ttlMs: 60_000});
    await manager.getPlaintextDataKey('workspace-1');
    manager.invalidate('workspace-1');

    expect((await manager.getPlaintextDataKey('workspace-1')).outcome).toBe('db_unwrapped');
  });
});
