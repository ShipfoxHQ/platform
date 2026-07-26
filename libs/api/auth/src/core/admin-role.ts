import type {AdminRole} from '@shipfox/api-auth-dto';
import {findCurrentAdminRole, revokeAdminGrant as revokeAdminGrantInDb} from '#db/admin-grants.js';
import {hasMinimumAdminRole} from './admin-role-model.js';
import {AdminRoleRequiredError} from './errors.js';

export {ADMIN_ROLES, hasMinimumAdminRole, highestAdminRole} from './admin-role-model.js';

export async function getCurrentAdminRole(params: {userId: string}): Promise<AdminRole | null> {
  return await findCurrentAdminRole(params);
}

export async function requireAdminRole(params: {
  userId: string;
  minimumRole: AdminRole;
}): Promise<AdminRole> {
  const role = await getCurrentAdminRole({userId: params.userId});
  if (!role || !hasMinimumAdminRole(role, params.minimumRole)) {
    throw new AdminRoleRequiredError(params.minimumRole);
  }
  return role;
}

export async function revokeAdminGrant(params: {grantId: string}) {
  return await revokeAdminGrantInDb(params);
}
