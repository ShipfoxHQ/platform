import {ClientError} from '@shipfox/node-fastify';
import {buildUserContext, rejectImpersonatedSession, setUserContext} from './index.js';

describe('rejectImpersonatedSession', () => {
  test('does nothing for an ordinary session', () => {
    const request = {};
    setUserContext(
      request,
      buildUserContext({
        userId: crypto.randomUUID(),
        email: 'user@example.com',
      }),
    );

    expect(() => rejectImpersonatedSession(request)).not.toThrow();
  });

  test('does nothing when no user context is set', () => {
    expect(() => rejectImpersonatedSession({})).not.toThrow();
  });

  test('throws impersonation-not-permitted for an impersonated session', () => {
    const request = {};
    setUserContext(
      request,
      buildUserContext({
        userId: crypto.randomUUID(),
        email: 'user@example.com',
        impersonatorId: crypto.randomUUID(),
      }),
    );

    const act = () => rejectImpersonatedSession(request);

    expect(act).toThrow(ClientError);
    expect(act).toThrow(
      expect.objectContaining({code: 'impersonation-not-permitted', status: 403}),
    );
  });
});
