import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage} from '#test/pages.js';
import {jsonResponse} from '#test/utils.js';
import {SignupPage} from './signup-page.js';

const SUBMITTED_EMAIL_RE = /new@example.com/;

describe('SignupPage', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('shows check-email state after success', async () => {
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user}, {status: 201}));
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('heading', {name: 'Check your email'})).toBeInTheDocument();
    expect(screen.getByText(SUBMITTED_EMAIL_RE)).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/auth/login');
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
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already exists');
  });
});
