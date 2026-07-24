import {parseRedirectContext} from './redirect-context.js';

describe('parseRedirectContext', () => {
  test('returns an ordinary safe return path', () => {
    const context = parseRedirectContext('/workspaces/acme?tab=runs');

    expect(context).toEqual({returnTo: '/workspaces/acme?tab=runs'});
  });

  test('separates an invitation token from generic redirect state', () => {
    const context = parseRedirectContext('/invitations/accept?token=raw-invitation-token');

    expect(context).toEqual({invitationToken: 'raw-invitation-token'});
    expect(context.returnTo).toBeUndefined();
  });

  test('separates an invitation token after path normalization', () => {
    const context = parseRedirectContext(
      '/workspaces/../invitations/accept?token=raw-invitation-token',
    );

    expect(context).toEqual({invitationToken: 'raw-invitation-token'});
  });

  test.each([
    ['/%2569nvitations/accept?token=double-encoded-token', 'double-encoded-token'],
    ['/%252569nvitations/accept?token=triple-encoded-token', 'triple-encoded-token'],
  ])('separates an invitation token from a deeply encoded path: %s', (redirect, token) => {
    const context = parseRedirectContext(redirect);

    expect(context).toEqual({invitationToken: token});
    expect(context.returnTo).toBeUndefined();
  });

  test.each([
    'https://attacker.example',
    '//attacker.example',
    '/auth/login',
    '/%61uth/login',
    '/%2561uth/login',
    '/%252561uth/login',
    '/%E0%80%80',
    '/safe/%25252e%25252e/auth/login',
  ])('rejects malformed or unsafe redirect %s', (redirect) => {
    const context = parseRedirectContext(redirect);

    expect(context).toEqual({});
  });

  test.each([
    ['/invitations/accept', {}],
    ['/invitations/accept?token=', {}],
    [
      '/invitations/other?token=raw-invitation-token',
      {
        returnTo: '/invitations/other?token=raw-invitation-token',
      },
    ],
  ])('does not treat %s as an invitation context', (redirect, expected) => {
    const context = parseRedirectContext(redirect);

    expect(context).toEqual(expected);
  });
});
