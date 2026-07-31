import {WORKSPACES_WORKSPACE_UPDATED} from '@shipfox/api-workspaces-dto';
import {sql} from 'drizzle-orm';
import {createWorkspaceForUser} from '#core/workspaces.js';
import {db} from '#db/db.js';
import {workspacesOutbox} from '#db/schema/outbox.js';
import {createWorkspacesTestApp, signupVerifyLogin} from '#test/routes.js';

describe('PATCH /workspaces/:workspaceId', () => {
  test('updates workspace details and writes the updated event', async () => {
    const app = await createWorkspacesTestApp();
    const owner = await signupVerifyLogin(app, 'workspace-update-owner');
    const workspace = await createWorkspaceForUser({
      name: 'Before',
      slug: `before-${crypto.randomUUID().slice(0, 8)}`,
      userId: owner.userId,
      userEmail: owner.email,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspace.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {name: 'After', slug: 'after'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({id: workspace.id, name: 'After', slug: 'after'});

    const [event] = await db()
      .select()
      .from(workspacesOutbox)
      .where(sql`${workspacesOutbox.payload}->>'workspaceId' = ${workspace.id}`)
      .orderBy(sql`${workspacesOutbox.createdAt} DESC`)
      .limit(1);
    expect(event).toMatchObject({
      eventType: WORKSPACES_WORKSPACE_UPDATED,
      payload: {workspaceId: workspace.id, name: 'After', slug: 'after'},
    });
  });

  test('rejects an empty body instead of writing a no-op updated event', async () => {
    const app = await createWorkspacesTestApp();
    const owner = await signupVerifyLogin(app, 'workspace-update-empty');
    const workspace = await createWorkspaceForUser({
      name: 'Untouched',
      slug: `untouched-${crypto.randomUUID().slice(0, 8)}`,
      userId: owner.userId,
      userEmail: owner.email,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspace.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns slug-conflict for a taken slug', async () => {
    const app = await createWorkspacesTestApp();
    const owner = await signupVerifyLogin(app, 'workspace-update-conflict');
    await createWorkspaceForUser({
      name: 'Taken',
      slug: 'taken',
      userId: crypto.randomUUID(),
    });
    const workspace = await createWorkspaceForUser({
      name: 'Available',
      slug: `available-${crypto.randomUUID().slice(0, 8)}`,
      userId: owner.userId,
      userEmail: owner.email,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspace.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {slug: 'taken'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
  });

  test('frees the old slug for immediate reuse', async () => {
    const app = await createWorkspacesTestApp();
    const owner = await signupVerifyLogin(app, 'workspace-update-reuse');
    const oldSlug = `old-${crypto.randomUUID().slice(0, 8)}`;
    const workspace = await createWorkspaceForUser({
      name: 'Renamed',
      slug: oldSlug,
      userId: owner.userId,
      userEmail: owner.email,
    });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspace.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {slug: 'renamed'},
    });

    expect(renamed.statusCode).toBe(200);
    await expect(
      createWorkspaceForUser({
        name: 'Reused',
        slug: oldSlug,
        userId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({slug: oldSlug});
  });
});
