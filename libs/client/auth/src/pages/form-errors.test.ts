import {ApiError} from '@shipfox/client-api';
import {
  loginErrorToFormError,
  passwordResetConfirmErrorToFormError,
  passwordResetRequestErrorToFormError,
  signupErrorToFormError,
  workspaceOnboardingErrorToFormError,
} from './form-errors.js';

function apiError(code: string, status = 400) {
  return new ApiError({code, message: `${code} server message`, status});
}

describe('loginErrorToFormError', () => {
  test('routes email-not-verified to the email field', () => {
    const result = loginErrorToFormError(apiError('email-not-verified'));

    expect(result).toEqual({
      kind: 'field',
      field: 'email',
      message: 'Verify your email before signing in.',
    });
  });

  test('routes invalid-credentials to a form-level alert', () => {
    const result = loginErrorToFormError(apiError('invalid-credentials'));

    expect(result).toEqual({kind: 'form', message: 'Email or password is incorrect.'});
  });

  test('routes rate-limited to a form-level alert', () => {
    const result = loginErrorToFormError(apiError('rate-limited', 429));

    expect(result).toEqual({
      kind: 'form',
      message: 'Too many attempts. Wait a bit and try again.',
    });
  });

  test('routes limiter outages to a form-level alert', () => {
    const result = loginErrorToFormError(apiError('auth-rate-limit-unavailable', 503));

    expect(result).toEqual({
      kind: 'form',
      message: 'Sign-in is temporarily unavailable. Try again soon.',
    });
  });

  test('routes unknown ApiError codes to a form-level alert', () => {
    const result = loginErrorToFormError(apiError('unknown-code', 400));

    expect(result).toEqual({kind: 'form', message: 'unknown-code server message'});
  });

  test('routes non-ApiError to a generic form-level alert', () => {
    const result = loginErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

describe('signupErrorToFormError', () => {
  test('routes email-taken to the email field', () => {
    const result = signupErrorToFormError(apiError('email-taken'));

    expect(result).toEqual({
      kind: 'field',
      field: 'email',
      message: 'An account already exists for this email.',
    });
  });

  test('routes other ApiError codes to a form-level alert', () => {
    const result = signupErrorToFormError(apiError('network-error'));

    expect(result).toEqual({
      kind: 'form',
      message: 'We could not reach the API. Check your connection and try again.',
    });
  });

  test('marks configured signup denial messages as Markdown', () => {
    const message = 'Read the [access policy](https://example.test/access).';
    const error = new ApiError({
      code: 'signup-not-allowed',
      message: 'Forbidden',
      status: 403,
      details: {code: 'signup-not-allowed', details: {message}},
    });

    const result = signupErrorToFormError(error);

    expect(result).toEqual({kind: 'form', message, format: 'markdown'});
  });
});

describe('passwordResetRequestErrorToFormError', () => {
  test('always routes to a form-level alert', () => {
    const result = passwordResetRequestErrorToFormError(apiError('rate-limited', 429));

    expect(result).toEqual({
      kind: 'form',
      message: 'Too many attempts. Wait a bit and try again.',
    });
  });
});

describe('passwordResetConfirmErrorToFormError', () => {
  test('routes token-invalid to a form-level alert', () => {
    const result = passwordResetConfirmErrorToFormError(apiError('token-invalid'));

    expect(result).toEqual({kind: 'form', message: 'This link is invalid or expired.'});
  });

  test('routes unknown errors to a generic form-level alert', () => {
    const result = passwordResetConfirmErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

describe('workspaceOnboardingErrorToFormError', () => {
  test('routes slug conflicts to the slug field', () => {
    const result = workspaceOnboardingErrorToFormError(apiError('slug-conflict', 409));

    expect(result).toEqual({
      kind: 'field',
      field: 'slug',
      message: 'That workspace slug is already taken.',
    });
  });

  test('routes other errors to a form-level alert', () => {
    const result = workspaceOnboardingErrorToFormError(apiError('conflict', 409));

    expect(result).toEqual({kind: 'form', message: 'conflict server message'});
  });
});
