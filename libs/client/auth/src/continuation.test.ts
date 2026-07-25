import {
  AuthActions,
  AuthShell,
  EmailCodeVerification,
  PasswordLoginForm,
  parseRedirectContext,
} from '@shipfox/client-auth/continuation';

describe('client-auth continuation exports', () => {
  test('publishes every continuation primitive through its public subpath', () => {
    expect(AuthActions).toBeTypeOf('function');
    expect(AuthShell).toBeTypeOf('function');
    expect(EmailCodeVerification).toBeTypeOf('function');
    expect(PasswordLoginForm).toBeTypeOf('function');
    expect(parseRedirectContext).toBeTypeOf('function');
  });
});
