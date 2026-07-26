import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {createAdminGrant} from '#db/admin-grants.js';
import {userFactory} from '#test/index.js';
import {createAuthInterModulePresentation} from './inter-module.js';

function createClient() {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(authInterModuleContract);
  transport.register(createAuthInterModulePresentation());
  transport.seal();
  return client;
}

describe('Auth inter-module administration role presentation', () => {
  test('returns the current role from Auth storage', async () => {
    const client = createClient();
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-owner'});

    await expect(client.getCurrentAdminRole({userId: user.id})).resolves.toEqual({
      role: 'admin-owner',
    });
    await expect(
      client.requireAdminRole({userId: user.id, minimumRole: 'admin-operator'}),
    ).resolves.toEqual({role: 'admin-owner'});
  });

  test('maps an insufficient current role to the declared known error', async () => {
    const client = createClient();
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-observer'});

    const error = await client
      .requireAdminRole({userId: user.id, minimumRole: 'admin-owner'})
      .catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error)) {
      expect(error.code).toBe('admin-role-required');
      expect(error.details).toEqual({requiredRole: 'admin-owner'});
    }
  });
});
