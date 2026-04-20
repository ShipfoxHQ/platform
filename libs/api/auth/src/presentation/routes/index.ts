import cookie from '@fastify/cookie';
import type {RouteGroup} from '@shipfox/node-fastify';
import {verifyEmailConfirmRoute} from './email-verification/verify-email-confirm.js';
import {verifyEmailResendRoute} from './email-verification/verify-email-resend.js';
import {changePasswordRoute} from './password/change-password.js';
import {passwordResetConfirmRoute} from './password/password-reset-confirm.js';
import {passwordResetRequestRoute} from './password/password-reset-request.js';
import {signupRoute} from './registration/signup.js';
import {loginRoute} from './session/login.js';
import {logoutRoute} from './session/logout.js';
import {meRoute} from './session/me.js';
import {refreshRoute} from './session/refresh.js';

export const authRoutes: RouteGroup = {
  prefix: '/auth',
  plugins: [cookie],
  routes: [
    signupRoute,
    verifyEmailConfirmRoute,
    verifyEmailResendRoute,
    loginRoute,
    refreshRoute,
    logoutRoute,
    meRoute,
    changePasswordRoute,
    passwordResetRequestRoute,
    passwordResetConfirmRoute,
  ],
};
