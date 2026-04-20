import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage} from '#test/pages.js';
import {jsonResponse} from '#test/utils.js';
import {LoginPage} from './login-page.js';

describe('LoginPage', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('validates fields and links to signup', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/login', <LoginPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Log in'}));

    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
    expect(screen.getByText('String must contain at least 1 character(s)')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Create an account'})).toHaveAttribute(
      'href',
      '/auth/signup',
    );
    expect(screen.getByRole('link', {name: 'Forgot password?'})).toHaveAttribute(
      'href',
      '/auth/reset',
    );
  });

  test('keeps credentials when switching to signup', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/login', <LoginPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: {value: 'new@example.com'},
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: {value: 'long secure password'},
    });
    fireEvent.click(screen.getByRole('link', {name: 'Create an account'}));

    expect(
      await screen.findByRole('heading', {name: 'Create your Shipfox account'}),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('long secure password');
  });

  test('posts valid credentials and navigates home', async () => {
    const user = pageUserFactory.build({email: 'login@example.com'});
    let requestBody: unknown;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        requestBody = await (input as Request).json();

        return jsonResponse({
          token: 'access-token',
          user,
        });
      });
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/login', <LoginPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: {value: 'login@example.com'},
    });
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'correct horse'}});
    fireEvent.click(screen.getByRole('button', {name: 'Log in'}));

    expect(await screen.findByRole('heading', {name: 'Authenticated home'})).toBeInTheDocument();
    const request = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/auth/login');
    expect(requestBody).toEqual({
      email: 'login@example.com',
      password: 'correct horse',
    });
  });
});
