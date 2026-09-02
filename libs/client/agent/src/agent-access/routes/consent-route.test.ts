import type {RouterContext} from '@shipfox/client-shell/runtime';
import consentRoute from '../../routes/agent-access-consent.js';

interface ConsentBeforeLoadArgs {
  context: RouterContext;
  location: {href: string};
}

type RedirectResponse = Response & {
  options: {to: string; search: {redirect: string}; replace?: boolean};
};

const beforeLoad = consentRoute.options.beforeLoad as (args: ConsentBeforeLoadArgs) => void;

describe('OAuth consent route', () => {
  test('preserves the opaque request URL when redirecting a guest to login', () => {
    const href = '/oauth/consent?request_id=opaque-request';
    let result: unknown;

    try {
      beforeLoad({context: {auth: guestAuth(), queryClient: undefined}, location: {href}});
    } catch (error) {
      result = error;
    }

    expect(result).toBeInstanceOf(Response);
    expect((result as RedirectResponse).options).toMatchObject({
      to: '/auth/login',
      search: {redirect: href},
    });
  });

  test('allows an authenticated session to review the request', () => {
    expect(() =>
      beforeLoad({
        context: {
          auth: {...guestAuth(), status: 'authenticated', isAuthenticated: true},
          queryClient: undefined,
        },
        location: {href: '/oauth/consent?request_id=opaque-request'},
      }),
    ).not.toThrow();
  });
});

function guestAuth() {
  return {
    status: 'guest' as const,
    isLoading: false,
    isAuthenticated: false,
    workspaces: [],
    hasWorkspace: false,
  };
}
