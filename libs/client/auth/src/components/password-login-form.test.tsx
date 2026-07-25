import {configureApiClient} from '@shipfox/client-api';
import {render, screen} from '@testing-library/react';
import {jsonResponse} from '#test/utils.js';
import {AuthProvider} from './auth-provider.js';
import {PasswordLoginForm} from './password-login-form.js';

describe('PasswordLoginForm', () => {
  beforeEach(() => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getAccessToken: undefined,
      refreshAccessToken: undefined,
    });
  });

  test('renders without a router context', async () => {
    render(
      <AuthProvider>
        <PasswordLoginForm invitationEmail="invitee@example.com" />
      </AuthProvider>,
    );

    expect(await screen.findByLabelText('Email')).toHaveValue('invitee@example.com');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Log in'})).toBeInTheDocument();
  });
});
