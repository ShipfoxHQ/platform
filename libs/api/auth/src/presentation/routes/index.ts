import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {SignupPolicy} from '#core/ports.js';
import {authCookiePlugin} from '#presentation/auth/refresh-cookie.js';
import {createVerifyEmailConfirmRoute} from './email-verification/verify-email-confirm.js';
import {verifyEmailResendRoute} from './email-verification/verify-email-resend.js';
import {changePasswordRoute} from './password/change-password.js';
import {createPasswordResetConfirmRoute} from './password/password-reset-confirm.js';
import {passwordResetRequestRoute} from './password/password-reset-request.js';
import {createSignupRoute} from './registration/signup.js';
import {createLoginRoute} from './session/login.js';
import {logoutRoute} from './session/logout.js';
import {meRoute} from './session/me.js';
import {createRefreshRoute} from './session/refresh.js';

export function buildAuthRoutes(
  passwordEnabled: boolean,
  workspaces: WorkspacesInterModuleClient,
  signupPolicy?: SignupPolicy,
): RouteGroup {
  const passwordRoutes = passwordEnabled
    ? [
        createSignupRoute(workspaces, signupPolicy),
        createVerifyEmailConfirmRoute(workspaces),
        verifyEmailResendRoute,
        createLoginRoute(workspaces),
      ]
    : [];

  return {
    prefix: '/auth',
    plugins: [authCookiePlugin],
    routes: [
      ...passwordRoutes,
      createRefreshRoute(workspaces),
      logoutRoute,
      meRoute,
      ...(passwordEnabled
        ? [
            changePasswordRoute,
            passwordResetRequestRoute,
            createPasswordResetConfirmRoute(workspaces),
          ]
        : []),
    ],
  };
}
