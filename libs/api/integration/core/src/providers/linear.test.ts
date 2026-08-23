import {
  getLinearInstallationByConnectionId,
  upsertLinearInstallation,
} from '@shipfox/api-integration-linear';
import {runMigrations} from '@shipfox/node-drizzle';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {linearProviderModule} from '#providers/linear.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';

describe('linearProviderModule', () => {
  const context = useIntegrationRouteTest();

  it('deletes the installation and tokens through the generic route before allowing a reinstall', async () => {
    const deleteSecrets = vi.fn(() => Promise.resolve(2));
    const scopedSecrets = {
      getSecret: vi.fn(() => Promise.resolve(null)),
      setSecrets: vi.fn(() => Promise.resolve()),
      deleteSecrets,
    };
    const linearPart = await linearProviderModule.load({
      secrets: {linear: scopedSecrets, deleteSecrets},
    });
    if (!linearPart.database) throw new Error('Linear provider database is not configured');
    const organizationId = crypto.randomUUID();

    await runMigrations(
      linearPart.database.db(),
      linearPart.database.migrationsPath,
      `__drizzle_migrations_${linearPart.database.databaseNamespace}`,
    );
    const app = await createTestApp([linearPart.provider]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'linear',
      externalAccountId: organizationId,
      slug: 'linear_acme',
      displayName: 'Linear Acme',
      capabilities: ['agent_tools'],
    });
    await upsertLinearInstallation({
      connectionId: connection.id,
      organizationId,
      organizationUrlKey: 'acme',
      appUserId: 'user-1',
      scopes: ['read'],
      status: 'installed',
      tokenExpiresAt: null,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
    await expect(getLinearInstallationByConnectionId(connection.id)).resolves.toBeUndefined();
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      namespace: connection.id,
    });

    const replacement = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'linear',
      externalAccountId: organizationId,
      slug: 'linear_acme_again',
      displayName: 'Linear Acme',
      capabilities: ['agent_tools'],
    });
    await upsertLinearInstallation({
      connectionId: replacement.id,
      organizationId,
      organizationUrlKey: 'acme',
      appUserId: 'user-1',
      scopes: ['read'],
      status: 'installed',
      tokenExpiresAt: null,
    });

    await expect(getLinearInstallationByConnectionId(replacement.id)).resolves.toMatchObject({
      organizationId,
    });
  });

  it('rolls back provider record cleanup when its transaction fails', async () => {
    const deleteSecrets = vi.fn(() => Promise.resolve(2));
    const scopedSecrets = {
      getSecret: vi.fn(() => Promise.resolve(null)),
      setSecrets: vi.fn(() => Promise.resolve()),
      deleteSecrets,
    };
    const linearPart = await linearProviderModule.load({
      secrets: {linear: scopedSecrets, deleteSecrets},
    });
    if (!linearPart.database) throw new Error('Linear provider database is not configured');
    const organizationId = crypto.randomUUID();

    await runMigrations(
      linearPart.database.db(),
      linearPart.database.migrationsPath,
      `__drizzle_migrations_${linearPart.database.databaseNamespace}`,
    );
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'linear',
      externalAccountId: organizationId,
      slug: 'linear_acme',
      displayName: 'Linear Acme',
      capabilities: ['agent_tools'],
    });
    await upsertLinearInstallation({
      connectionId: connection.id,
      organizationId,
      organizationUrlKey: 'acme',
      appUserId: 'user-1',
      scopes: ['read'],
      status: 'installed',
      tokenExpiresAt: null,
    });

    await expect(
      db().transaction(async (tx) => {
        await linearPart.provider.deleteConnectionRecords?.(connection, {tx});
        throw new Error('transaction failed');
      }),
    ).rejects.toThrow('transaction failed');

    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
    });
    await expect(getLinearInstallationByConnectionId(connection.id)).resolves.toMatchObject({
      connectionId: connection.id,
    });
    expect(deleteSecrets).not.toHaveBeenCalled();
  });
});
