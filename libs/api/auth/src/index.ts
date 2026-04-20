import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {authRoutes} from '#presentation/routes/index.js';

export type {EmailVerification} from '#core/entities/email-verification.js';
export type {PasswordReset} from '#core/entities/password-reset.js';
export type {RefreshToken} from '#core/entities/refresh-token.js';
export type {User, UserStatus} from '#core/entities/user.js';
export {db, migrationsPath} from '#db/index.js';
export {createJwtAuthMethod, getClientContext} from '#presentation/auth/jwt-auth.js';
export {authRoutes as routes} from '#presentation/routes/index.js';

export const authModule: ShipfoxModule = {
  name: 'auth',
  database: {db, migrationsPath},
  auth: [createJwtAuthMethod()],
  routes: [authRoutes],
};
