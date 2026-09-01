import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  agentAccessNameSchema,
  agentGrantSummarySchema,
  createAgentPersonalAccessTokenBodySchema,
} from './agent-access.js';
import {oauthDynamicClientRegistrationRequestSchema} from './oauth.js';

describe('agent access name schemas', () => {
  it('rejects names that exceed the UTF-8 byte bound', () => {
    const value = '😀'.repeat(65);

    expect([...value]).toHaveLength(65);
    expect(new TextEncoder().encode(value)).toHaveLength(260);
    expect(agentAccessNameSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ['NUL', 'Agent\0name'],
    ['right-to-left override', 'Agent\u202ename'],
    ['zero-width joiner', 'Agent\u200dname'],
  ])('rejects %s characters in PAT and OAuth client names', (_name, value) => {
    expect(agentAccessNameSchema.safeParse(value).success).toBe(false);
    expect(
      agentGrantSummarySchema.safeParse({
        id: crypto.randomUUID(),
        client_name: value,
        workspace_id: crypto.randomUUID(),
        scopes: ['read'],
        created_at: new Date().toISOString(),
        last_refreshed_at: null,
      }).success,
    ).toBe(false);
    expect(
      createAgentPersonalAccessTokenBodySchema.safeParse({
        workspace_id: crypto.randomUUID(),
        name: value,
      }).success,
    ).toBe(false);
    expect(
      oauthDynamicClientRegistrationRequestSchema.safeParse({
        client_name: value,
        redirect_uris: ['https://client.example/callback'],
      }).success,
    ).toBe(false);
  });

  it('accepts an ASCII name at the 256-byte boundary and defaults PAT expiry to 90 days', () => {
    expect(agentAccessNameSchema.safeParse('a'.repeat(256)).success).toBe(true);

    const parsed = createAgentPersonalAccessTokenBodySchema.parse({
      workspace_id: crypto.randomUUID(),
      name: 'CI access',
    });
    expect(parsed.expires_in_days).toBe(90);
  });
});
