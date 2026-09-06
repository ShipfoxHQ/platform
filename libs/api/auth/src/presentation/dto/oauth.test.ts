import {describe, expect, it} from '@shipfox/vitest/vi';
import type {OAuthConsentDetail} from '#core/oauth-flow.js';
import {toOAuthConsentResponse} from './oauth.js';

const NOW = new Date('2026-09-06T12:00:00.000Z');

function consentDetail(clientId: string): OAuthConsentDetail {
  return {
    request: {
      id: '11111111-1111-4111-8111-111111111111',
      clientId,
      userId: '22222222-2222-4222-8222-222222222222',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example.test/mcp',
      scopes: ['read'],
      codeChallenge: 'challenge',
      state: 'state',
      expiresAt: NOW,
      consumedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    client: {
      id: '33333333-3333-4333-8333-333333333333',
      clientId,
      name: 'CIMD agent',
      redirectUris: ['https://client.example/callback'],
      kind: 'cimd',
      lastSeenAt: NOW,
      unreferencedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    workspaces: [],
  };
}

describe('OAuth presentation DTOs', () => {
  it.each([
    {
      clientId: 'https://client.example/.well-known/oauth-client',
      expectedOrigin: 'https://client.example',
      label: 'uses the origin of a CIMD client ID',
    },
    {
      clientId: 'legacy-cimd-client',
      expectedOrigin: 'legacy-cimd-client',
      label: 'preserves an invalid stored CIMD client ID',
    },
  ])('$label', ({clientId, expectedOrigin}) => {
    expect(toOAuthConsentResponse(consentDetail(clientId))).toMatchObject({
      client_identity_kind: 'cimd',
      client_identity_origin: expectedOrigin,
    });
  });
});
