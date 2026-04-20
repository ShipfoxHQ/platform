import {ApiError} from '@shipfox/client-api';

export type FieldErrors<T extends string> = Partial<Record<T, string>>;

interface ZodLikeError {
  issues: Array<{path: Array<PropertyKey>; message: string}>;
}

export function fieldErrorsFromZod<T extends string>(error: ZodLikeError): FieldErrors<T> {
  const errors: FieldErrors<T> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !errors[key as T]) {
      errors[key as T] = issue.message;
    }
  }
  return errors;
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
  if (error.code === 'network-error') {
    return 'We could not reach the API. Check your connection and try again.';
  }

  return error.message || 'Something went wrong. Try again.';
}
