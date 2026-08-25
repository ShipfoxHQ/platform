import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {AgentSessionKekVersionStrandedError} from '#core/errors.js';
import {db, sessionDataKeys, updateSessionDataKeyWrapCas} from '#db/index.js';
import {createSessionKeyProvider} from './key-provider.js';
import {rotateAgentSessionDataKeysWithProvider} from './rotate-kek.js';

describe('rotateAgentSessionDataKeysWithProvider', () => {
  it('rewraps previous-version session data keys under the current KEK', async () => {
    const workspaceId = crypto.randomUUID();
    const currentKek = crypto.randomBytes(32);
    const previousKek = crypto.randomBytes(32);
    const currentProvider = createSessionKeyProvider(currentKek, previousKek);
    const previousProvider = createSessionKeyProvider(previousKek);
    const dek = crypto.randomBytes(32);
    const previousWrapped = previousProvider.wrapDek(workspaceId, dek);
    await db()
      .insert(sessionDataKeys)
      .values({workspaceId, ...previousWrapped});

    const result = await rotateAgentSessionDataKeysWithProvider(currentProvider, {
      workspaceIds: [workspaceId],
    });
    const rows = await db()
      .select()
      .from(sessionDataKeys)
      .where(eq(sessionDataKeys.workspaceId, workspaceId));
    const row = rows[0];
    if (!row) throw new Error('Expected rotated session data key');

    expect(result).toEqual({rotated: 1, skipped: 0});
    expect(row.kekVersion).toBe(currentProvider.currentKeyVersion);
    expect(row.wrappedDek).not.toBe(previousWrapped.wrappedDek);
    expect(row.rotatedAt).toBeInstanceOf(Date);
    expect(currentProvider.unwrapDek(workspaceId, row.wrappedDek, row.kekVersion)).toEqual(dek);
  });

  it('is idempotent and does nothing for an empty workspace selection', async () => {
    const workspaceId = crypto.randomUUID();
    const currentKek = crypto.randomBytes(32);
    const previousKek = crypto.randomBytes(32);
    const currentProvider = createSessionKeyProvider(currentKek, previousKek);
    const previousWrapped = createSessionKeyProvider(previousKek).wrapDek(
      workspaceId,
      crypto.randomBytes(32),
    );
    await db()
      .insert(sessionDataKeys)
      .values({workspaceId, ...previousWrapped});

    const empty = await rotateAgentSessionDataKeysWithProvider(currentProvider, {
      workspaceIds: [],
    });
    const first = await rotateAgentSessionDataKeysWithProvider(currentProvider, {
      workspaceIds: [workspaceId],
    });
    const second = await rotateAgentSessionDataKeysWithProvider(currentProvider, {
      workspaceIds: [workspaceId],
    });

    expect(empty).toEqual({rotated: 0, skipped: 0});
    expect(first).toEqual({rotated: 1, skipped: 0});
    expect(second).toEqual({rotated: 0, skipped: 1});
  });

  it('does not clobber a session data key after a concurrent rotation wins', async () => {
    const workspaceId = crypto.randomUUID();
    const currentProvider = createSessionKeyProvider(crypto.randomBytes(32));
    const oldProvider = createSessionKeyProvider(crypto.randomBytes(32));
    const oldWrapped = oldProvider.wrapDek(workspaceId, crypto.randomBytes(32));
    const freshWrapped = currentProvider.wrapDek(workspaceId, crypto.randomBytes(32));
    await db()
      .insert(sessionDataKeys)
      .values({workspaceId, ...freshWrapped});

    const updated = await updateSessionDataKeyWrapCas({
      workspaceId,
      oldKekVersion: oldWrapped.kekVersion,
      wrappedDek: oldWrapped.wrappedDek,
      kekVersion: oldWrapped.kekVersion,
    });
    const rows = await db()
      .select()
      .from(sessionDataKeys)
      .where(eq(sessionDataKeys.workspaceId, workspaceId));

    expect(updated).toBe(false);
    expect(rows[0]?.wrappedDek).toBe(freshWrapped.wrappedDek);
    expect(rows[0]?.kekVersion).toBe(freshWrapped.kekVersion);
  });

  it('fails before writing when any session data key version is stranded', async () => {
    const workspaceId = crypto.randomUUID();
    await db().insert(sessionDataKeys).values({
      workspaceId,
      wrappedDek: 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      kekVersion: 'local:stranded',
    });

    await expect(
      rotateAgentSessionDataKeysWithProvider(createSessionKeyProvider(crypto.randomBytes(32)), {
        workspaceIds: [workspaceId],
      }),
    ).rejects.toThrow(AgentSessionKekVersionStrandedError);
  });
});
