import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import {config} from '@shipfox/e2e-core';
import {authorizeAgentAccess} from '@shipfox/e2e-setup-auth';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {expect, test} from './test.js';

test('rate-limits a fresh agent-access credential within one window', async ({request, auth}) => {
  const apiOrigin = new URL(config.API_URL).origin;
  const publicOrigin = new URL(config.API_PUBLIC_URL).origin;
  const clientOrigin = new URL(config.CLIENT_BASE_URL).origin;
  const user = await auth.createUser();
  const session = await auth.createSession({user_id: user.user.id});
  const workspace = await createWorkspace({userId: user.user.id, userEmail: user.email});
  const tokenBody = await authorizeAgentAccess({
    request,
    apiOrigin,
    publicOrigin,
    sessionToken: session.token,
    workspaceId: workspace.id,
    clientName: 'Agent Access Rate Limit E2E Client',
    redirectUri: 'http://127.0.0.1:43125/oauth/callback',
  });
  const client = new Client({name: 'agent-access-rate-limit-e2e-client', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', apiOrigin), {
    requestInit: {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        origin: clientOrigin,
      },
    },
  });

  try {
    await client.connect(transport as unknown as Transport);
    let wasRateLimited = false;
    for (let callsRemaining = 61; callsRemaining > 0; callsRemaining -= 1) {
      const result = await client.callTool(
        {name: 'list_projects', arguments: {}},
        CallToolResultSchema,
      );
      const envelope = agentAccessEnvelopeSchema.parse(result.structuredContent);
      if (envelope.ok === false && envelope.error?.code === 'rate-limited') {
        expect(envelope.error.retry_after_seconds).toEqual(expect.any(Number));
        wasRateLimited = true;
        break;
      }
      expect(envelope.ok).toBe(true);
    }
    expect(wasRateLimited).toBe(true);
  } finally {
    await client.close();
  }
});
