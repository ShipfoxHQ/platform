import {createInvitation, reconcileInvitationAcceptance} from './invitations.js';
import {createMembership} from './memberships.js';
import {
  createWorkspace,
  getWorkspaceById,
  getWorkspaceServiceMetrics,
  listAdminWorkspaces,
  updateWorkspace,
} from './workspaces.js';

describe('workspace queries', () => {
  describe('createWorkspace', () => {
    test('inserts a workspace with defaults and returns entity', async () => {
      const workspace = await createWorkspace({name: 'Acme'});

      expect(workspace.id).toBeDefined();
      expect(workspace.name).toBe('Acme');
      expect(workspace.status).toBe('active');
      expect(workspace.settings).toEqual({});
      expect(workspace.createdAt).toBeInstanceOf(Date);
      expect(workspace.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('getWorkspaceById', () => {
    test('returns the workspace when found', async () => {
      const created = await createWorkspace({name: 'Lookup Test'});

      const found = await getWorkspaceById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Lookup Test');
    });

    test('returns undefined when not found', async () => {
      const found = await getWorkspaceById(crypto.randomUUID());

      expect(found).toBeUndefined();
    });
  });

  describe('updateWorkspace', () => {
    test('updates only provided fields', async () => {
      const created = await createWorkspace({name: 'Before'});

      const updated = await updateWorkspace({id: created.id, name: 'After'});

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('After');
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    test('updates status', async () => {
      const created = await createWorkspace({name: 'Status Update'});

      const updated = await updateWorkspace({id: created.id, status: 'suspended'});

      expect(updated?.status).toBe('suspended');
    });

    test('returns undefined for non-existent workspace', async () => {
      const result = await updateWorkspace({id: crypto.randomUUID(), name: 'Ghost'});

      expect(result).toBeUndefined();
    });
  });

  describe('getWorkspaceServiceMetrics', () => {
    test('counts current workspace service state', async () => {
      const activeWorkspace = await createWorkspace({
        name: `Metrics Active ${crypto.randomUUID()}`,
      });
      await createMembership({
        userId: crypto.randomUUID(),
        workspaceId: activeWorkspace.id,
      });
      const openInvitation = await createInvitation({
        workspaceId: activeWorkspace.id,
        email: `open-${crypto.randomUUID()}@example.com`,
        hashedToken: `open-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
        invitedByUserId: crypto.randomUUID(),
        skipEmail: true,
      });
      const acceptedInvitation = await createInvitation({
        workspaceId: activeWorkspace.id,
        email: `accepted-${crypto.randomUUID()}@example.com`,
        hashedToken: `accepted-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
        invitedByUserId: crypto.randomUUID(),
        skipEmail: true,
      });
      await createInvitation({
        workspaceId: activeWorkspace.id,
        email: `expired-${crypto.randomUUID()}@example.com`,
        hashedToken: `expired-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() - 60_000),
        invitedByUserId: crypto.randomUUID(),
        skipEmail: true,
      });
      await reconcileInvitationAcceptance({
        invitationId: acceptedInvitation.id,
        acceptedByUserId: crypto.randomUUID(),
        email: acceptedInvitation.email,
      });

      const metrics = await getWorkspaceServiceMetrics();

      expect(openInvitation.acceptedAt).toBeNull();
      expect(metrics.activeWorkspaces).toBeGreaterThanOrEqual(1);
      expect(metrics.memberships).toBeGreaterThanOrEqual(2);
      expect(metrics.openInvitations).toBeGreaterThanOrEqual(1);
    });
  });

  describe('listAdminWorkspaces', () => {
    test('returns bounded, name-ordered pages with member counts', async () => {
      const prefix = `Admin page ${crypto.randomUUID()}`;
      const alpha = await createWorkspace({name: `${prefix} Alpha`});
      const bravo = await createWorkspace({name: `${prefix} Bravo`});
      const charlie = await createWorkspace({name: `${prefix} Charlie`});
      await createMembership({userId: crypto.randomUUID(), workspaceId: bravo.id});
      await createMembership({userId: crypto.randomUUID(), workspaceId: bravo.id});

      const firstPage = await listAdminWorkspaces({search: prefix, limit: 2});
      const secondPage = await listAdminWorkspaces({
        search: prefix,
        limit: 2,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(firstPage.workspaces.map(({id}) => id)).toEqual([alpha.id, bravo.id]);
      expect(firstPage.workspaces.map(({memberCount}) => memberCount)).toEqual([0, 2]);
      expect(firstPage.nextCursor).toEqual({value: bravo.name, id: bravo.id});
      expect(secondPage.workspaces.map(({id}) => id)).toEqual([charlie.id]);
      expect(secondPage.nextCursor).toBeNull();
    });
  });
});
