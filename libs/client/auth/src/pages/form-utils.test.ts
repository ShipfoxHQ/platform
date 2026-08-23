import {ApiError} from '@shipfox/client-api';
import {authErrorMessage, authErrorMessageFormat} from './form-utils.js';

describe('authErrorMessage', () => {
  test.each([
    ['invalid-credentials', 'Email or password is incorrect.'],
    ['email-not-verified', 'Verify your email before signing in.'],
    ['email-taken', 'An account already exists for this email.'],
    ['token-invalid', 'This link is invalid or expired.'],
    ['rate-limited', 'Too many attempts. Wait a bit and try again.'],
    ['auth-rate-limit-unavailable', 'Sign-in is temporarily unavailable. Try again soon.'],
    ['network-error', 'We could not reach the API. Check your connection and try again.'],
  ])('maps %s to client copy', (code, message) => {
    const error = new ApiError({code, message: 'Server copy', status: 400});

    const result = authErrorMessage(error);

    expect(result).toBe(message);
  });

  test('falls back to API error messages', () => {
    const error = new ApiError({code: 'unknown-api-code', message: 'Try later', status: 429});

    const result = authErrorMessage(error);

    expect(result).toBe('Try later');
  });

  test('renders the configured signup denial message from safe error details', () => {
    const error = new ApiError({
      code: 'signup-not-allowed',
      message: 'Forbidden',
      status: 403,
      details: {code: 'signup-not-allowed', details: {message: 'Ask your administrator to join.'}},
    });
    const result = authErrorMessage(error);
    expect(result).toBe('Ask your administrator to join.');
  });
  test('uses generic copy for unknown errors', () => {
    const result = authErrorMessage(new Error('boom'));

    expect(result).toBe('Something went wrong. Try again.');
  });
});

describe('authErrorMessageFormat', () => {
  test('returns Markdown for signup denial errors that declare it', () => {
    const error = new ApiError({
      code: 'signup-not-allowed',
      message: 'Forbidden',
      status: 403,
      details: {details: {format: 'markdown'}},
    });

    const result = authErrorMessageFormat(error);

    expect(result).toBe('markdown');
  });

  test.each([
    [
      'a different error code',
      new ApiError({
        code: 'unknown-api-code',
        message: 'Try later',
        status: 400,
        details: {details: {format: 'markdown'}},
      }),
    ],
    [
      'an unsupported signup denial format',
      new ApiError({
        code: 'signup-not-allowed',
        message: 'Forbidden',
        status: 403,
        details: {details: {format: 'html'}},
      }),
    ],
    ['a non-API error', new Error('boom')],
  ])('returns undefined for %s', (_case, error) => {
    const result = authErrorMessageFormat(error);

    expect(result).toBeUndefined();
  });
});
