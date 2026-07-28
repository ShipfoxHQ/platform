import {ApiError} from '@shipfox/client-api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function signupNotAllowedMessage(error: ApiError): string | undefined {
  if (error.code !== 'signup-not-allowed') return undefined;
  if (!isRecord(error.details)) return undefined;
  const details = error.details.details;
  if (!isRecord(details)) return undefined;
  return typeof details.message === 'string' ? details.message : undefined;
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';

  if (error.code === 'invalid-credentials') {
    return 'Email or password is incorrect.';
  }
  if (error.code === 'email-not-verified') {
    return 'Verify your email before signing in.';
  }
  if (error.code === 'email-taken') {
    return 'An account already exists for this email.';
  }
  if (error.code === 'token-invalid') {
    return 'This link is invalid or expired.';
  }
  if (error.code === 'rate-limited') {
    return 'Too many attempts. Wait a bit and try again.';
  }
  if (error.code === 'auth-rate-limit-unavailable') {
    return 'Sign-in is temporarily unavailable. Try again soon.';
  }
  if (error.code === 'network-error') {
    return 'We could not reach the API. Check your connection and try again.';
  }

  const signupMessage = signupNotAllowedMessage(error);
  if (signupMessage) return signupMessage;
  return error.message || 'Something went wrong. Try again.';
}
