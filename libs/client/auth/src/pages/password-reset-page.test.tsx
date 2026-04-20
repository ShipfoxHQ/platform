import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage} from '#test/pages.js';
import {jsonResponse, requestUrl} from '#test/utils.js';
import {PasswordResetPage} from './password-reset-page.js';

describe('PasswordResetPage', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('validates the request email and links back to login', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/reset', <PasswordResetPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Send reset link'}));

    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/auth/login');
  });

  test('requests a reset link for a valid email', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/password-reset')) {
        requestBody = await (input as Request).json();

        return new Response(null, {status: 204});
      }
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401});
      }

      return jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404});
    });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/reset', <PasswordResetPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: {value: 'Reset@Example.com'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Send reset link'}));

    expect(await screen.findByRole('heading', {name: 'Check your email'})).toBeInTheDocument();
    expect(
      screen.getByText(
        'If a Shipfox account exists for that email, the reset link will arrive shortly.',
      ),
    ).toBeInTheDocument();
    const resetCall = fetchImpl.mock.calls.find(([input]) =>
      requestUrl(input).endsWith('/auth/password-reset'),
    );
    const request = resetCall?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/auth/password-reset');
    expect(requestBody).toEqual({email: 'reset@example.com'});
  });

  test('validates the new password for reset confirmation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/reset?token=reset-token', <PasswordResetPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Update password'}));

    expect(
      await screen.findByText('String must contain at least 12 character(s)'),
    ).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('confirms a password reset token', async () => {
    const user = pageUserFactory.build({email: 'reset@example.com'});
    let requestBody: unknown;
    let didConfirm = false;
    const fetchImpl = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/password-reset/confirm')) {
        requestBody = await (input as Request).json();
        didConfirm = true;
        return jsonResponse({token: 'reset-access-token', user});
      }
      if (url.endsWith('/auth/refresh')) {
        return didConfirm
          ? jsonResponse({token: 'refreshed-access-token', user})
          : jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401});
      }

      return jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404});
    });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/reset?token=reset-token', <PasswordResetPage />);
    fireEvent.change(await screen.findByLabelText('New password'), {
      target: {value: 'new password is long'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Update password'}));

    expect(await screen.findByRole('heading', {name: 'Authenticated home'})).toBeInTheDocument();
    expect(
      await screen.findByText('Your password has been changed. You are now logged in.'),
    ).toBeInTheDocument();
    const confirmCall = fetchImpl.mock.calls.find(([input]) =>
      requestUrl(input).endsWith('/auth/password-reset/confirm'),
    );
    const request = confirmCall?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/auth/password-reset/confirm');
    expect(requestBody).toEqual({
      token: 'reset-token',
      new_password: 'new password is long',
    });
  });

  test('reports invalid reset tokens', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/password-reset/confirm')) {
        return Promise.resolve(
          jsonResponse({code: 'token-invalid', message: 'Reset token expired'}, {status: 410}),
        );
      }

      return Promise.resolve(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/reset?token=bad-token', <PasswordResetPage />);
    fireEvent.change(await screen.findByLabelText('New password'), {
      target: {value: 'new password is long'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Update password'}));

    expect(await screen.findByText('This link is invalid or expired.')).toBeInTheDocument();
  });
});
