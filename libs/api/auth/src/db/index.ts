import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {CreateEmailVerificationParams} from './email-verifications.js';
export {consumeEmailVerification, createEmailVerification} from './email-verifications.js';
export type {CreatePasswordResetParams} from './password-resets.js';
export {consumePasswordReset, createPasswordReset} from './password-resets.js';
export type {CreateRefreshTokenParams} from './refresh-tokens.js';
export {
  createRefreshToken,
  findActiveRefreshTokenByHash,
  revokeRefreshTokenByHash,
  revokeRefreshTokensForUser,
  rotateActiveRefreshToken,
} from './refresh-tokens.js';
export type {CreateUserParams, UpdateUserPasswordParams} from './users.js';
export {
  createUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  updateUserPassword,
} from './users.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
