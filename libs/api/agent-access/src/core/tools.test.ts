import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {createAgentAccessFixtureTool} from './tools.js';

const context: AgentAccessContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
};

describe('agent-access fixture tool', () => {
  test('accepts 256 Unicode code points even when they use surrogate pairs', async () => {
    const message = '😀'.repeat(256);
    const result = await createAgentAccessFixtureTool().execute({
      context,
      arguments: {message},
    });

    expect(result).toEqual({ok: true, result: {message}});
    expect(agentAccessEnvelopeSchema.safeParse(result).success).toBe(true);
  });

  test('rejects messages over the limit and undeclared arguments', async () => {
    const tool = createAgentAccessFixtureTool();
    const tooLong = await tool.execute({
      context,
      arguments: {message: '😀'.repeat(257)},
    });
    const extraProperty = await tool.execute({
      context,
      arguments: {message: 'valid', unexpected: true},
    });

    expect(tooLong).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(extraProperty).toMatchObject({ok: false, error: {code: 'invalid-request'}});
  });
});
