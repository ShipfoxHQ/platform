import {eq} from 'drizzle-orm';
import {userFactory} from '#test/index.js';
import {createAdminGrant} from './admin-grants.js';
import {listAdministratorUserSummaries} from './admin-user-summary.js';
import {db} from './db.js';
import {users} from './schema/users.js';

async function setCreatedAt(userId: string, createdAt: Date): Promise<void> {
  await db().update(users).set({createdAt}).where(eq(users.id, userId));
}

describe('administrator user summaries db', () => {
  test('lists users in descending created-at and id order with a limit-plus-one cursor', async () => {
    const marker = `directory-order-${crypto.randomUUID()}`;
    const actor = await userFactory.create({email: `${marker}-actor@example.com`});
    const first = await userFactory.create({email: `${marker}-first@example.com`});
    const second = await userFactory.create({email: `${marker}-second@example.com`});
    const third = await userFactory.create({email: `${marker}-third@example.com`});
    const base = new Date('2099-01-01T00:00:00.000Z');
    await setCreatedAt(actor.id, new Date(base.getTime() - 1_000));
    await setCreatedAt(first.id, new Date(base.getTime() + 2_000));
    await setCreatedAt(second.id, new Date(base.getTime() + 2_000));
    await setCreatedAt(third.id, new Date(base.getTime() + 1_000));
    const sameTimestampOrder = [first, second].sort((left, right) => {
      if (right.id < left.id) return -1;
      if (right.id > left.id) return 1;
      return 0;
    });
    const newerSameTimestamp = sameTimestampOrder[0];
    const olderSameTimestamp = sameTimestampOrder[1];
    if (!newerSameTimestamp || !olderSameTimestamp) {
      throw new Error('Expected two users with the same timestamp');
    }

    const unfiltered = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      limit: 4,
    });
    expect(unfiltered.rows.slice(0, 4).map(({id}) => id)).toEqual([
      newerSameTimestamp.id,
      olderSameTimestamp.id,
      third.id,
      actor.id,
    ]);

    const firstPage = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      limit: 2,
      search: marker,
    });

    expect(firstPage.rows.map(({id}) => id)).toEqual([
      newerSameTimestamp.id,
      olderSameTimestamp.id,
    ]);
    expect(firstPage.nextCursor).toEqual({
      createdAt: new Date(base.getTime() + 2_000),
      id: olderSameTimestamp.id,
    });

    const insertedAfterPage = await userFactory.create({
      email: `${marker}-inserted@example.com`,
    });
    await setCreatedAt(insertedAfterPage.id, new Date(base.getTime() + 4_000));

    const secondPage = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      limit: 2,
      search: marker,
      ...(firstPage.nextCursor ? {cursor: firstPage.nextCursor} : {}),
    });

    expect(secondPage.rows.map(({id}) => id)).toEqual([third.id, actor.id]);
    expect(secondPage.nextCursor).toBeNull();
  });

  test('uses exact UUID search and case-insensitive multi-term literal matching', async () => {
    const actor = await userFactory.create({email: `actor-${crypto.randomUUID()}@example.com`});
    const user = await userFactory.create({
      email: `literal%_\\${crypto.randomUUID()}@Example.com`,
      name: 'Ada Lovelace',
    });
    await userFactory.create({
      email: `literal%_${crypto.randomUUID()}@example.com`,
      name: 'Ada Byron',
    });

    const exact = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: user.id,
      limit: 10,
    });
    expect(exact.rows.map(({id}) => id)).toEqual([user.id]);

    const matching = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: '  ADA   LOVELACE  ',
      limit: 10,
    });
    expect(matching.rows.map(({id}) => id)).toEqual([user.id]);

    const literal = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: '%_',
      limit: 10,
    });
    expect(literal.rows.map(({id}) => id)).toContain(user.id);

    const literalBackslash = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: '\\',
      limit: 10,
    });
    expect(literalBackslash.rows.map(({id}) => id)).toEqual([user.id]);
  });

  test.each(['active', 'suspended', 'deleted'] as const)('filters by %s status', async (status) => {
    const marker = `directory-status-${status}-${crypto.randomUUID()}`;
    const actor = await userFactory.create({email: `actor-${crypto.randomUUID()}@example.com`});
    const user = await userFactory.create({email: `${marker}-user@example.com`});
    await db().update(users).set({status}).where(eq(users.id, user.id));

    const result = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: marker,
      status,
      limit: 10,
    });

    expect(result.rows).toEqual([expect.objectContaining({id: user.id, status})]);
  });

  test('applies eligibility rules and projects the highest effective role once per user', async () => {
    const marker = `directory-eligible-${crypto.randomUUID()}`;
    const actor = await userFactory.create({
      email: `${marker}-actor@example.com`,
      emailVerifiedAt: new Date(),
    });
    const eligible = await userFactory.create({
      email: `${marker}-eligible@example.com`,
      emailVerifiedAt: new Date(),
    });
    const unverified = await userFactory.create({email: `${marker}-unverified@example.com`});
    const granted = await userFactory.create({
      email: `${marker}-granted@example.com`,
      emailVerifiedAt: new Date(),
    });
    const suspended = await userFactory.create({
      email: `${marker}-suspended@example.com`,
      emailVerifiedAt: new Date(),
    });
    const deleted = await userFactory.create({
      email: `${marker}-deleted@example.com`,
      emailVerifiedAt: new Date(),
    });
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, suspended.id));
    await db().update(users).set({status: 'deleted'}).where(eq(users.id, deleted.id));
    await createAdminGrant({userId: granted.id, role: 'admin-observer'});
    await createAdminGrant({userId: granted.id, role: 'admin-operator'});
    await createAdminGrant({userId: suspended.id, role: 'admin-observer'});
    await createAdminGrant({userId: deleted.id, role: 'admin-owner'});

    const all = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: marker,
      limit: 20,
    });
    expect(all.rows.filter(({id}) => id === granted.id)).toHaveLength(1);
    expect(all.rows.find(({id}) => id === granted.id)?.adminRole).toBe('admin-operator');
    expect(all.rows.find(({id}) => id === suspended.id)?.adminRole).toBeNull();
    expect(all.rows.find(({id}) => id === deleted.id)?.adminRole).toBeNull();

    const eligibleRows = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: marker,
      eligible: true,
      limit: 20,
    });
    expect(eligibleRows.rows.map(({id}) => id)).toEqual([eligible.id]);
    expect(eligibleRows.rows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({id: actor.id})]),
    );
    expect(unverified.id).not.toBe(eligibleRows.rows[0]?.id);

    const ineligibleRows = await listAdministratorUserSummaries(db(), {
      actorId: actor.id,
      search: marker,
      eligible: false,
      limit: 20,
    });
    expect(ineligibleRows.rows.map(({id}) => id)).toEqual(
      expect.arrayContaining([actor.id, unverified.id, granted.id, suspended.id, deleted.id]),
    );
    expect(ineligibleRows.rows.map(({id}) => id)).not.toContain(eligible.id);
  });
});
