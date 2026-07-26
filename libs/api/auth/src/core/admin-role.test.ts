import {createAdminGrant} from '#db/admin-grants.js';
import {userFactory} from '#test/index.js';
import {hasMinimumAdminRole, highestAdminRole, requireAdminRole} from './admin-role.js';
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
