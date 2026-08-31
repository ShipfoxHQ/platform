import {createAdminGrant} from '#db/admin-grants.js';
import {userFactory} from '#test/index.js';
import {hasMinimumAdminRole, highestAdminRole, requireAdminRole} from './admin-role.js';
import {listAdministratorUsers} from './administration.js';
import type {AdminRoleRequiredError} from './errors.js';

describe('admin role policy', () => {
  test.each([
    ['admin-observer', 'admin-observer', true],
    ['admin-observer', 'admin-operator', false],
    ['admin-operator', 'admin-observer', true],
    ['admin-operator', 'admin-owner', false],
    ['admin-owner', 'admin-observer', true],
    ['admin-owner', 'admin-operator', true],
    ['admin-owner', 'admin-owner', true],
  ] as const)('%s satisfies %s: %s', (role, minimumRole, expected) => {
    expect(hasMinimumAdminRole(role, minimumRole)).toBe(expected);
  });

  test('selects the highest role from fixed grants', () => {
    expect(highestAdminRole(['admin-observer', 'admin-owner', 'admin-operator'])).toBe(
      'admin-owner',
    );
    expect(highestAdminRole([])).toBeNull();
  });

  test('protects the administrator user directory with the observer role', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});

    await expect(listAdministratorUsers({actorId: user.id, limit: 10})).rejects.toEqual(
      expect.objectContaining<Partial<AdminRoleRequiredError>>({
        minimumRole: 'admin-observer',
      }),
    );
  });

  test('bounds administrator user directory search input', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-observer'});

    await expect(
      listAdministratorUsers({
        actorId: user.id,
        limit: 10,
        search: Array.from({length: 11}, () => 'term').join(' '),
      }),
    ).rejects.toThrow('at most 10 terms');
    await expect(
      listAdministratorUsers({actorId: user.id, limit: 10, search: 'x'.repeat(101)}),
    ).rejects.toThrow('at most 100 characters');
  });

  test('evaluates the current role from Auth storage for every required minimum', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-operator'});

    await expect(requireAdminRole({userId: user.id, minimumRole: 'admin-observer'})).resolves.toBe(
      'admin-operator',
    );
    await expect(requireAdminRole({userId: user.id, minimumRole: 'admin-owner'})).rejects.toEqual(
      expect.objectContaining<Partial<AdminRoleRequiredError>>({
        minimumRole: 'admin-owner',
      }),
    );
  });
});
