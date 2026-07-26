import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {mintLeaseToken} from './lease-token.js';

export const workflowsTestAuthClient: AuthInterModuleClient = {
  mintRunnerSessionToken() {
    throw new Error('Runner session token minting is not configured');
  },
  async mintJobLeaseToken(claims) {
    return {token: await mintLeaseToken(claims)};
  },
  getCurrentAdminRole() {
    return Promise.resolve({role: null});
  },
  requireAdminRole() {
    return Promise.reject(
      new Error('Administrator role checks are not configured in workflow tests'),
    );
  },
};
