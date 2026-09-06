import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import {config} from '@shipfox/e2e-core';
import {authorizeAgentAccess} from '@shipfox/e2e-setup-auth';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {expect, test} from './test.js';

test('rate-limits a fresh agent-access credential during one burst', async ({request, auth}) => {
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
    const envelopes = await Promise.all(
      Array.from({length: 61}, async () => {
        const result = await client.callTool(
          {name: 'list_projects', arguments: {}},
          CallToolResultSchema,
        );
        return agentAccessEnvelopeSchema.parse(result.structuredContent);
      }),
    );
    let allowedCount = 0;
    let rateLimitedCount = 0;
    for (const envelope of envelopes) {
      if (envelope.ok) {
        allowedCount += 1;
      } else if (envelope.error?.code === 'rate-limited') {
        expect(envelope.error.retry_after_seconds).toEqual(expect.any(Number));
        rateLimitedCount += 1;
      } else {
        throw new Error(`Unexpected agent-access response: ${JSON.stringify(envelope)}`);
      }
    }
    expect(allowedCount + rateLimitedCount).toBe(61);
    expect(allowedCount).toBeLessThanOrEqual(60);
    expect(rateLimitedCount).toBeGreaterThanOrEqual(1);
  } finally {
    await client.close();
  }
});
