import {configureApiClient} from '@shipfox/client-api';
import {act, fireEvent, screen, waitFor, within} from '@testing-library/react';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage} from '#test/pages.js';
import {jsonResponse, requestUrl} from '#test/utils.js';
import {SignupPage} from './signup-page.js';

const SUBMITTED_EMAIL_RE = /new@example.com/;
const RESEND_COUNTDOWN_RE = /^Resend in \d+s$/;
const ACCESS_POLICY_RE = /access policy/i;
function emailChallenge() {
  return {
    id: '019f814f-3cfd-779a-82f2-6588eefd572c',
    next_resend_available_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('shows check-email state after success', async () => {
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    let signupBody: unknown;
    const fetchImpl = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === 'https://api.example.test/auth/me') {
        return jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401});
      }
      if (url === 'https://api.example.test/auth/signup' && input instanceof Request) {
        signupBody = await input.json();
        return jsonResponse({user, email_challenge: emailChallenge()}, {status: 201});
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: '  New User  '}});
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('heading', {name: 'Check your email'})).toBeInTheDocument();
    expect(signupBody).toEqual({
      email: 'new@example.com',
      password: 'long secure password',
      name: 'New User',
    });
    expect(screen.getByText(SUBMITTED_EMAIL_RE)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: RESEND_COUNTDOWN_RE})).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Use another email'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/auth/login');
  });

  test('submits the eight-digit verification code with its signup challenge', async () => {
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    let confirmBody: unknown;
    const session = {token: 'access-token', user};
    const fetchImpl = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === 'https://api.example.test/auth/me') {
        return jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401});
      }
      if (url === 'https://api.example.test/auth/signup') {
        return jsonResponse({user, email_challenge: emailChallenge()}, {status: 201});
      }
      if (
        url === 'https://api.example.test/auth/verify-email/confirm' &&
        input instanceof Request
      ) {
        confirmBody = await input.json();
        return jsonResponse(session);
      }
      if (url === 'https://api.example.test/auth/refresh') {
        return jsonResponse(session);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: user.email}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    await screen.findByRole('heading', {name: 'Check your email'});
    fireEvent.change(screen.getByLabelText('Verification code'), {target: {value: '12345678'}});
    fireEvent.click(screen.getByRole('button', {name: 'Verify email'}));

    await waitFor(() => {
      expect(confirmBody).toEqual({
        email: user.email,
        challenge_id: emailChallenge().id,
        code: '12345678',
      });
    });
  });

  test('keeps credentials when switching to login', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: {value: 'existing@example.com'},
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: {value: 'long secure password'},
    });
    fireEvent.click(screen.getByRole('link', {name: 'Log in'}));

    expect(await screen.findByRole('heading', {name: 'Connect to Shipfox'})).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('existing@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('long secure password');
  });

  test('preserves invitation state when switching to login', async () => {
    const invitationToken = 'invite-token';
    const redirect = `/invitations/accept?token=${encodeURIComponent(invitationToken)}`;
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === 'https://api.example.test/auth/me') {
        return Promise.resolve(
          jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
        );
      }
      if (url.includes('/invitations/preview?')) {
        return Promise.resolve(
          jsonResponse({
            status: 'pending',
            workspace_id: '11111111-1111-4111-8111-111111111111',
            workspace_name: 'Invite Workspace',
            email: 'invitee@example.com',
            invited_by_display: 'owner@example.com',
            expires_at: '2026-05-18T00:00:00.000Z',
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    configureApiClient({fetchImpl});

    renderAuthPage(`/auth/signup?redirect=${encodeURIComponent(redirect)}`, <SignupPage />);
    await screen.findByRole('heading', {name: 'Join Invite Workspace'});

    expect(screen.getByRole('link', {name: 'Log in'})).toHaveAttribute(
      'href',
      `/auth/login?redirect=${encodeURIComponent(redirect)}`,
    );
  });

  test('keeps invitation signup recoverable when the post-signup refresh fails', async () => {
    const invitationToken = 'invite-token';
    const redirect = `/invitations/accept?token=${encodeURIComponent(invitationToken)}`;
    const user = pageUserFactory.build({email: 'invitee@example.com', name: 'Invitee'});
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const session = {token: 'access-token', user};
    let signupCompleted = false;
    let postSignupRefreshFailures = 0;
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === 'https://api.example.test/auth/me') {
        return jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401});
      }
      if (url.includes('/invitations/preview?')) {
        return jsonResponse({
          status: 'pending',
          workspace_id: workspaceId,
          workspace_name: 'Invite Workspace',
          email: user.email,
          invited_by_display: 'owner@example.com',
          expires_at: '2026-05-18T00:00:00.000Z',
        });
      }
      if (url === 'https://api.example.test/auth/signup') {
        signupCompleted = true;
        return jsonResponse(
          {
            user,
            membership: {
              id: '22222222-2222-4222-8222-222222222222',
              user_id: user.id,
              workspace_id: workspaceId,
            },
          },
          {status: 201},
        );
      }
      if (url === 'https://api.example.test/auth/refresh') {
        if (signupCompleted && postSignupRefreshFailures < 2) {
          postSignupRefreshFailures += 1;
          return jsonResponse({code: 'server-error', message: 'Refresh failed'}, {status: 500});
        }
        return jsonResponse(session);
      }
      if (url === 'https://api.example.test/workspaces') {
        return jsonResponse({
          memberships: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              user_id: user.id,
              workspace_id: workspaceId,
              created_at: '2026-05-01T00:00:00.000Z',
              updated_at: '2026-05-01T00:00:00.000Z',
              workspace_name: 'Invite Workspace',
              workspace_slug: 'invite-workspace',
              workspace_status: 'active',
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    configureApiClient({fetchImpl});

    renderAuthPage(`/auth/signup?redirect=${encodeURIComponent(redirect)}`, <SignupPage />);
    await screen.findByRole('heading', {name: 'Join Invite Workspace'});
    fireEvent.change(screen.getByLabelText('Name'), {target: {value: user.name}});
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: user.email}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('button', {name: 'Retry sign-in'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Join Invite Workspace'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Retry sign-in'}));
    expect(await screen.findByRole('heading', {name: 'Authenticated home'})).toBeInTheDocument();
  });

  test('surfaces duplicate-email errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {code: 'email-already-exists', message: 'Email already exists'},
          {status: 409},
        ),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already exists');
  });

  test('renders configured signup denial messages as Markdown', async () => {
    const message = [
      '## Signups require approval',
      '',
      '- Review the [access policy](https://example.test/access).',
    ].join('\n');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {code: 'signup-not-allowed', message: 'Forbidden', details: {message}},
          {status: 403},
        ),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', {level: 2, name: 'Signups require approval'}),
    ).toBeInTheDocument();
    expect(within(alert).getByRole('listitem')).toBeInTheDocument();
    expect(within(alert).getByRole('link', {name: ACCESS_POLICY_RE})).toHaveAttribute(
      'href',
      'https://example.test/access',
    );
  });

  test('validates the name locally', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New\u202eUser'}});
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(
      await screen.findByText(
        'Name cannot include line breaks, tabs, or hidden formatting characters.',
      ),
    ).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('requires the name locally', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('enables resend after the signup cooldown expires', async () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(
        jsonResponse({user, email_challenge: emailChallenge()}, {status: 201}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    expect(await screen.findByRole('button', {name: RESEND_COUNTDOWN_RE})).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByRole('button', {name: 'Resend verification email'})).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  test('resends verification email and restarts cooldown from the server response', async () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const nextResendAvailableAt = new Date(Date.now() + 120_000).toISOString();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user, email_challenge: emailChallenge()}, {status: 201}))
      .mockResolvedValueOnce(
        jsonResponse({next_resend_available_at: nextResendAvailableAt}, {status: 200}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    await screen.findByRole('heading', {name: 'Check your email'});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    fireEvent.click(screen.getByRole('button', {name: 'Resend verification email'}));

    expect(
      await screen.findByText('If another verification email can be sent, it will arrive shortly.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: RESEND_COUNTDOWN_RE})).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('surfaces resend failures without leaving the check-email state', async () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user, email_challenge: emailChallenge()}, {status: 201}))
      .mockResolvedValueOnce(
        jsonResponse({code: 'server-error', message: 'Server error'}, {status: 500}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    await screen.findByRole('heading', {name: 'Check your email'});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    fireEvent.click(screen.getByRole('button', {name: 'Resend verification email'}));

    expect(await screen.findByText('Server error')).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Check your email'})).toBeInTheDocument();
  });

  test('returns to the signup form when choosing another email', async () => {
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(
        jsonResponse({user, email_challenge: emailChallenge()}, {status: 201}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    await screen.findByRole('heading', {name: 'Check your email'});
    fireEvent.click(screen.getByRole('button', {name: 'Use another email'}));

    expect(screen.getByRole('heading', {name: 'Create your Shipfox account'})).toBeInTheDocument();
  });
});
