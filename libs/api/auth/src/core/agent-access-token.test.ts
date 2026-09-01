import {agentAccessTokenKey, userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {issueAgentAccessToken, verifyAgentAccessToken} from './agent-access-token.js';
import {signUserToken, verifyUserToken} from './jwt.js';

function claims() {
  return {
    sub: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    grantId: crypto.randomUUID(),
    clientId: 'client_123',
    scopes: ['read' as const],
  };
}

describe('agent-access-token', () => {
  test('issues and verifies a token with its dedicated signing key', async () => {
    const input = claims();

    const token = await issueAgentAccessToken(input);
    const verified = await verifyAgentAccessToken(token);

    expect(verified).toMatchObject(input);
  });

  test('does not cross-verify agent and session tokens', async () => {
    const input = claims();
    const agentToken = await issueAgentAccessToken(input);

    await expect(
      verifyUserToken({token: agentToken, secret: userAccessTokenKey()}),
    ).rejects.toThrow();

    const sessionToken = await signUserToken({
      userId: input.sub,
      email: 'agent@example.test',
      memberships: [],
      secret: userAccessTokenKey(),
      expiresIn: '15m',
    });

    expect(await verifyAgentAccessToken(sessionToken)).toBeNull();
    expect(agentAccessTokenKey()).not.toEqual(userAccessTokenKey());
  });
});
