import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {CreateInvitationParams} from './invitations.js';
export {
  createInvitation,
  findInvitationByToken,
  listOpenInvitationsByWorkspace,
  revokeInvitation,
} from './invitations.js';
export type {
  CreateMembershipParams,
  MembershipWithUser,
  MembershipWithWorkspace,
  RemoveMembershipParams,
} from './memberships.js';
export {
  createMembership,
  findMembership,
  listMembershipsByUser,
  listMembershipsByWorkspace,
  removeMembership,
} from './memberships.js';
export {workspacesOutbox} from './schema/outbox.js';
export type {
  AdminWorkspaceRow,
  CreateWorkspaceParams,
  ListAdminWorkspaceParams,
  ListAdminWorkspaceResult,
  UpdateWorkspaceParams,
  WorkspaceServiceMetrics,
} from './workspaces.js';
export {
  createWorkspace,
  getWorkspaceById,
  getWorkspaceServiceMetrics,
  listAdminWorkspaces,
  updateWorkspace,
} from './workspaces.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
