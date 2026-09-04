import type {UserContextMembership} from '@shipfox/api-auth-context';
import {CONNECTION_REPOSITORY_ACCESS_CHANGED} from '@shipfox/api-integration-core-dto';
import {vi} from '@shipfox/vitest/vi';
import {sql} from 'drizzle-orm';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('repository access mutation routes', () => {
  const context = useIntegrationRouteTest();

  it('updates the repository access mode idempotently and audits the acting user', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})]);
    const connection = await createConnection();

    const first = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });
    const afterFirst = await getIntegrationConnectionById(connection.id);
    const repeated = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });

    const events = await auditEvents(connection.id);
    const reloaded = await getIntegrationConnectionById(connection.id);

    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(first.json()).toEqual({mode: 'all'});
    expect(repeated.json()).toEqual({mode: 'all'});
    expect(reloaded?.repositoryAccessMode).toBe('all');
    expect(reloaded?.updatedAt).toEqual(afterFirst?.updatedAt);
    expect(events).toHaveLength(2);
    expect(events[0]?.orderingKey).toBe(connection.id);
    expect(events[0]?.payload).toMatchObject({
      actorId: 'user-1',
      workspaceId: context.workspaceId,
      connectionId: connection.id,
      provider: 'gitea',
      mode: 'all',
    });
  });

  it('restores selected repository access after granting all access', async () => {
    const invalidateRepositoryAuthorizationCache = vi.fn();
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      repositoryAuthorizer: {
        enabled: false,
        resolveRepositoryAuthorization: () => Promise.resolve(undefined),
        invalidateRepositoryAuthorizationCache,
      },
    });
    const connection = await createConnection();

    const allResponse = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });
    const selectedResponse = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'selected'},
    });
    const reloaded = await getIntegrationConnectionById(connection.id);
    const events = await auditEvents(connection.id);

    expect(allResponse.statusCode).toBe(200);
    expect(selectedResponse.statusCode).toBe(200);
    expect(selectedResponse.json()).toEqual({mode: 'selected'});
    expect(reloaded?.repositoryAccessMode).toBe('selected');
    expect(events).toHaveLength(2);
    expect(events).toMatchObject([
      {
        orderingKey: connection.id,
        payload: {
          actorId: 'user-1',
          workspaceId: context.workspaceId,
          connectionId: connection.id,
          provider: 'gitea',
          mode: 'all',
        },
      },
      {
        orderingKey: connection.id,
        payload: {
          actorId: 'user-1',
          workspaceId: context.workspaceId,
          connectionId: connection.id,
          provider: 'gitea',
          mode: 'selected',
        },
      },
    ]);
    expect(invalidateRepositoryAuthorizationCache).toHaveBeenCalledTimes(2);
    expect(invalidateRepositoryAuthorizationCache).toHaveBeenNthCalledWith(1, connection.id);
    expect(invalidateRepositoryAuthorizationCache).toHaveBeenNthCalledWith(2, connection.id);
  });

  it('requires a workspace admin', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      memberships: [
        {
          workspaceId: context.workspaceId,
          role: 'member' as UserContextMembership['role'],
          workspaceStatus: 'active',
        },
      ],
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('forbidden');
    expect((await getIntegrationConnectionById(connection.id))?.repositoryAccessMode).toBe(
      'selected',
    );
    expect(await auditEvents(connection.id)).toHaveLength(0);
  });

  it('rejects impersonated sessions before changing the mode', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})]);
    const connection = await createConnection();

    const response = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer impersonated'},
      payload: {mode: 'all'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('impersonation-not-permitted');
    expect((await getIntegrationConnectionById(connection.id))?.repositoryAccessMode).toBe(
      'selected',
    );
    expect(await auditEvents(connection.id)).toHaveLength(0);
  });

  it('rejects unsupported providers before changing the mode', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await createConnection();

    const response = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('integration-repository-access-unsupported');
    expect((await getIntegrationConnectionById(connection.id))?.repositoryAccessMode).toBe(
      'selected',
    );
  });

  it('invalidates the authorization cache after a committed mode change', async () => {
    const invalidateRepositoryAuthorizationCache = vi.fn();
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      repositoryAuthorizer: {
        enabled: false,
        resolveRepositoryAuthorization: () => Promise.resolve(undefined),
        invalidateRepositoryAuthorizationCache,
      },
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });

    expect(response.statusCode).toBe(200);
    expect(invalidateRepositoryAuthorizationCache).toHaveBeenCalledOnce();
    expect(invalidateRepositoryAuthorizationCache).toHaveBeenCalledWith(connection.id);
  });

  async function createConnection() {
    return await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: crypto.randomUUID(),
      slug: `gitea_${crypto.randomUUID()}`,
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
  }

  async function auditEvents(connectionId: string) {
    return await db()
      .select({
        payload: integrationsOutbox.payload,
        orderingKey: integrationsOutbox.orderingKey,
      })
      .from(integrationsOutbox)
      .where(
        sql`${integrationsOutbox.eventType} = ${CONNECTION_REPOSITORY_ACCESS_CHANGED} AND ${integrationsOutbox.payload}->>'connectionId' = ${connectionId}`,
      )
      .orderBy(integrationsOutbox.createdAt, integrationsOutbox.id);
  }
});
