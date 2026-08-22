import {ApiError} from '@shipfox/client-api';
import {authErrorMessage} from './form-utils.js';

export type FormErrorMapping<TField extends string> =
  | {kind: 'field'; field: TField; message: string}
  | {kind: 'form'; message: string; format?: 'markdown'};

type LoginField = 'email' | 'password';
type SignupField = 'email' | 'password' | 'name';
type PasswordResetRequestField = 'email';
type PasswordResetConfirmField = 'new_password';

function apiCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function loginErrorToFormError(error: unknown): FormErrorMapping<LoginField> {
  if (apiCode(error) === 'email-not-verified') {
    return {kind: 'field', field: 'email', message: authErrorMessage(error)};
  }
  return {kind: 'form', message: authErrorMessage(error)};
}

export function signupErrorToFormError(error: unknown): FormErrorMapping<SignupField> {
  if (apiCode(error) === 'email-taken') {
    return {kind: 'field', field: 'email', message: authErrorMessage(error)};
  }
  if (apiCode(error) === 'signup-not-allowed') {
    return {kind: 'form', message: authErrorMessage(error), format: 'markdown'};
  }
  return {kind: 'form', message: authErrorMessage(error)};
}

export function passwordResetRequestErrorToFormError(
  error: unknown,
): FormErrorMapping<PasswordResetRequestField> {
  return {kind: 'form', message: authErrorMessage(error)};
}

export function passwordResetConfirmErrorToFormError(
  error: unknown,
): FormErrorMapping<PasswordResetConfirmField> {
  return {kind: 'form', message: authErrorMessage(error)};
}

export function workspaceOnboardingErrorToFormError(
  error: unknown,
): FormErrorMapping<'name' | 'slug'> {
  if (apiCode(error) === 'slug-conflict') {
    return {kind: 'field', field: 'slug', message: 'That workspace slug is already taken.'};
  }
  return {kind: 'form', message: authErrorMessage(error)};
}
