export {
  type ConfirmEmailVerificationResult,
  changePassword,
  confirmEmailVerification,
  confirmPasswordReset,
  type GetCurrentUserResult,
  getCurrentUser,
  type LoginParams,
  type LoginResult,
  login,
  logout,
  type RefreshAccessTokenResult,
  refreshAccessToken,
  requestPasswordReset,
  resendEmailVerification,
  type SignupParams,
  signup,
} from './auth.js';
export type {EmailVerification} from './entities/email-verification.js';
export type {PasswordReset} from './entities/password-reset.js';
export type {RefreshToken} from './entities/refresh-token.js';
export type {User, UserStatus} from './entities/user.js';
export {
  EmailNotVerifiedError,
  EmailTakenError,
  InvalidCredentialsError,
  TokenInvalidError,
  UserNotFoundError,
} from './errors.js';
export {
  signUserToken,
  type UserTokenClaims,
  verifyUserToken,
} from './jwt.js';
export {hashPassword, verifyPassword} from './password.js';
