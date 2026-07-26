import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {getCurrentAdminRole, requireAdminRole} from '#core/admin-role.js';
import {AdminRoleRequiredError} from '#core/errors.js';
import {issueJobLeaseToken} from '#core/job-lease-token.js';
import {issueRunnerSessionToken} from '#core/runner-session-token.js';

export function createAuthInterModulePresentation(): InterModulePresentation<
  typeof authInterModuleContract
> {
  return defineInterModulePresentation(authInterModuleContract, {
    mintRunnerSessionToken: async (claims) => ({token: await issueRunnerSessionToken(claims)}),
    mintJobLeaseToken: async (claims) => ({token: await issueJobLeaseToken(claims)}),
    getCurrentAdminRole: async ({userId}) => ({role: await getCurrentAdminRole({userId})}),
    requireAdminRole: async ({userId, minimumRole}) => {
      try {
        return {role: await requireAdminRole({userId, minimumRole})};
      } catch (error) {
        if (error instanceof AdminRoleRequiredError) {
          throw createInterModuleKnownError(
            authInterModuleContract.methods.requireAdminRole,
            'admin-role-required',
            {requiredRole: error.minimumRole},
          );
        }
        throw error;
      }
    },
  });
}
