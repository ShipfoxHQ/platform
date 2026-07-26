import type {AdminRole} from '@shipfox/api-auth-dto';

export const ADMIN_ROLES: readonly AdminRole[] = [
  'admin-observer',
  'admin-operator',
  'admin-owner',
];

const ADMIN_ROLE_RANK: Record<AdminRole, number> = {
  'admin-observer': 1,
  'admin-operator': 2,
  'admin-owner': 3,
};

export function hasMinimumAdminRole(role: AdminRole, minimumRole: AdminRole): boolean {
  return ADMIN_ROLE_RANK[role] >= ADMIN_ROLE_RANK[minimumRole];
}

export function highestAdminRole(roles: readonly AdminRole[]): AdminRole | null {
  return roles.reduce<AdminRole | null>(
    (highest, role) =>
      highest === null || ADMIN_ROLE_RANK[role] > ADMIN_ROLE_RANK[highest] ? role : highest,
    null,
  );
}
