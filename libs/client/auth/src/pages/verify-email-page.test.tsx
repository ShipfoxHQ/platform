import {configureApiClient} from '@shipfox/client-api';
import {screen, waitFor} from '@testing-library/react';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage, renderStrictAuthPage} from '#test/pages.js';
import {jsonResponse, requestUrl} from '#test/utils.js';
import {VerifyEmailPage} from './verify-email-page.js';

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('confirms a valid token', async () => {
    const user = pageUserFactory.build();
    let didVerify = false;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/verify-email/confirm')) {
        didVerify = true;
        return Promise.resolve(jsonResponse({token: 'verified-access-token', user}));
      }
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          didVerify
            ? jsonResponse({token: 'refreshed-access-token', user})
            : jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
        );
      }
      return Promise.resolve(
        jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/verify-email?token=token-123', <VerifyEmailPage />);

    expect(await screen.findByRole('heading', {name: 'Authenticated home'})).toBeInTheDocument();
    expect(
      await screen.findByText('Your email is verified. You are now logged in.'),
    ).toBeInTheDocument();
    const refreshCalls = fetchImpl.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith('/auth/refresh'),
    );
    expect(refreshCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('only confirms once under StrictMode', async () => {
    const user = pageUserFactory.build();
    let didVerify = false;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/verify-email/confirm')) {
        didVerify = true;
        return Promise.resolve(jsonResponse({token: 'verified-access-token', user}));
      }
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          didVerify
            ? jsonResponse({token: 'refreshed-access-token', user})
            : jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
        );
      }
      return Promise.resolve(
        jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
      );
    });
    configureApiClient({fetchImpl});

    renderStrictAuthPage('/auth/verify-email?token=strict-token', <VerifyEmailPage />);

    expect(await screen.findByRole('heading', {name: 'Authenticated home'})).toBeInTheDocument();
    expect(
      await screen.findByText('Your email is verified. You are now logged in.'),
    ).toBeInTheDocument();
    const verifyCalls = fetchImpl.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith('/auth/verify-email/confirm'),
    );
    expect(verifyCalls).toHaveLength(1);
  });

  test('reports an invalid token', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/verify-email/confirm')) {
        return Promise.resolve(
          jsonResponse({code: 'invalid-token', message: 'Invalid token'}, {status: 400}),
        );
      }
      return Promise.resolve(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/verify-email?token=bad-token', <VerifyEmailPage />);

    expect(await screen.findByText('Invalid token')).toBeInTheDocument();
  });

  test('handles missing token locally', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/verify-email', <VerifyEmailPage />);

    expect(await screen.findByRole('heading', {name: 'Authenticated home'})).toBeInTheDocument();
    expect(
      await screen.findByText('This verification link is missing a token.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  });
});
