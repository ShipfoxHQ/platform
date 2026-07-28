import {eq} from 'drizzle-orm';
import {LastAdminOwnerError} from '#core/errors.js';
import {userFactory} from '#test/index.js';
import {
  createAdminGrant,
  findCurrentAdminRole,
  hasActiveAdminOwner,
  revokeAdminGrant,
} from './admin-grants.js';
import {db} from './db.js';
import {users} from './schema/users.js';

describe('admin grants db', () => {
  test('evaluates the highest active grant independently of workspace roles', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const observer = await createAdminGrant({userId: user.id, role: 'admin-observer'});
    await createAdminGrant({userId: user.id, role: 'admin-operator'});

    expect(observer.userId).toBe(user.id);
    expect(await findCurrentAdminRole({userId: user.id})).toBe('admin-operator');
  });

  test('does not evaluate revoked grants or grants for suspended users', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const grant = await createAdminGrant({userId: user.id, role: 'admin-owner'});

    await expect(revokeAdminGrant({grantId: grant.id})).rejects.toBeInstanceOf(LastAdminOwnerError);
    expect(await findCurrentAdminRole({userId: user.id})).toBe('admin-owner');

    await db().update(users).set({status: 'suspended'}).where(eq(users.id, user.id));
    expect(await findCurrentAdminRole({userId: user.id})).toBeNull();
  });

  test('does not report a suspended owner as active', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-owner'});

    await expect(hasActiveAdminOwner()).resolves.toBe(true);

    await db().update(users).set({status: 'suspended'}).where(eq(users.id, user.id));

    await expect(hasActiveAdminOwner()).resolves.toBe(false);
  });

  test('prevents revoking the final active owner but permits replacement first', async () => {
    const firstOwner = await userFactory.create({emailVerifiedAt: new Date()});
    const secondOwner = await userFactory.create({emailVerifiedAt: new Date()});
    const firstGrant = await createAdminGrant({userId: firstOwner.id, role: 'admin-owner'});
    const secondGrant = await createAdminGrant({userId: secondOwner.id, role: 'admin-owner'});

    await expect(revokeAdminGrant({grantId: firstGrant.id})).resolves.toMatchObject({
      id: firstGrant.id,
      revokedAt: expect.any(Date),
    });
    await expect(revokeAdminGrant({grantId: secondGrant.id})).rejects.toBeInstanceOf(
      LastAdminOwnerError,
    );
    expect(await findCurrentAdminRole({userId: secondOwner.id})).toBe('admin-owner');
  });

  test('enforces one active grant of each fixed role per user', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-observer'});

    await expect(createAdminGrant({userId: user.id, role: 'admin-observer'})).rejects.toThrow();
  });
});
