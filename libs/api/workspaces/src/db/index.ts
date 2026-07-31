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
export type {
  ConsumeWorkspacesRateLimitParams,
  ConsumeWorkspacesRateLimitResult,
} from './rate-limits.js';
export {
  consumeWorkspacesRateLimit,
  pruneExpiredWorkspacesRateLimits,
} from './rate-limits.js';
export {workspacesAdminCommandResults} from './schema/admin-command-results.js';
export {workspacesOutbox} from './schema/outbox.js';
export {workspacesRateLimits} from './schema/rate-limits.js';
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
  isWorkspaceSlugAvailable,
  listAdminWorkspaces,
  updateWorkspace,
} from './workspaces.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
