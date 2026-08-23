import {
  toActiveProvisioner,
  toActiveProvisionersResponse,
  toCreatedManualRegistrationToken,
  toCreatedProvisionerToken,
  toCreateTokenBody,
  toManualRegistrationToken,
  toProvisionerToken,
} from './token-mapper.js';

describe('toManualRegistrationToken', () => {
  test('maps a transport token to its package-owned model', () => {
    const result = toManualRegistrationToken({
      id: '11111111-1111-4111-8111-111111111111',
      workspace_id: '22222222-2222-4222-8222-222222222222',
      prefix: 'sf_mrt_test',
      name: null,
      expires_at: null,
      revoked_at: null,
      created_at: '2026-07-22T10:00:00.000Z',
      updated_at: '2026-07-22T10:00:00.000Z',
    });

    expect(result).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      prefix: 'sf_mrt_test',
      name: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
    });
  });
});

describe('toProvisionerToken', () => {
  test('maps a transport provisioner token to its package-owned model', () => {
    const result = toProvisionerToken({
      id: '33333333-3333-4333-8333-333333333333',
      scope: 'workspace',
      workspace_id: '22222222-2222-4222-8222-222222222222',
      prefix: 'sf_pt_test',
      name: 'Docker provisioner',
      created_by_user_id: '44444444-4444-4444-8444-444444444444',
      revoked_by_user_id: null,
      expires_at: null,
      revoked_at: null,
      last_seen_at: '2026-07-22T09:00:00.000Z',
      created_at: '2026-07-22T10:00:00.000Z',
      updated_at: '2026-07-22T10:00:00.000Z',
    });

    expect(result).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      prefix: 'sf_pt_test',
      name: 'Docker provisioner',
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
      createdByUserId: '44444444-4444-4444-8444-444444444444',
      revokedByUserId: null,
      lastSeenAt: '2026-07-22T09:00:00.000Z',
    });
  });
});

describe('toActiveProvisioner', () => {
  test('maps a transport active provisioner to its package-owned model', () => {
    const result = toActiveProvisioner({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Docker provisioner',
      prefix: 'sf_pt_test',
      last_seen_at: '2026-07-22T09:00:00.000Z',
    });

    expect(result).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Docker provisioner',
      prefix: 'sf_pt_test',
      lastSeenAt: '2026-07-22T09:00:00.000Z',
    });
  });
});

describe('toActiveProvisionersResponse', () => {
  test('maps the transport response to its package-owned model', () => {
    const result = toActiveProvisionersResponse({
      provisioners: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Docker provisioner',
          prefix: 'sf_pt_test',
          last_seen_at: '2026-07-22T09:00:00.000Z',
        },
      ],
      installation_runners: 'none',
    });

    expect(result[0]).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Docker provisioner',
      prefix: 'sf_pt_test',
      lastSeenAt: '2026-07-22T09:00:00.000Z',
    });
    expect(result.installationRunners).toBe('none');
  });
});

describe('toCreatedManualRegistrationToken', () => {
  test('maps a raw-token creation response to its package-owned model', () => {
    const result = toCreatedManualRegistrationToken({
      id: '77777777-7777-4777-8777-777777777777',
      raw_token: 'sf_mrt_raw-created-token',
      prefix: 'sf_mrt_test',
      name: null,
      workspace_id: '22222222-2222-4222-8222-222222222222',
      expires_at: null,
      created_at: '2026-07-22T10:00:00.000Z',
    });

    expect(result).toEqual({
      token: 'sf_mrt_raw-created-token',
      id: '77777777-7777-4777-8777-777777777777',
      prefix: 'sf_mrt_test',
      name: null,
      workspaceId: '22222222-2222-4222-8222-222222222222',
      expiresAt: null,
      createdAt: '2026-07-22T10:00:00.000Z',
    });
  });
});

describe('toCreatedProvisionerToken', () => {
  test('maps a raw-token provisioner creation response to its package-owned model', () => {
    const result = toCreatedProvisionerToken({
      id: '77777777-7777-4777-8777-777777777777',
      raw_token: 'sf_pt_raw-created-token',
      prefix: 'sf_pt_test',
      name: 'Docker provisioner',
      workspace_id: '22222222-2222-4222-8222-222222222222',
      created_by_user_id: '44444444-4444-4444-8444-444444444444',
      revoked_by_user_id: null,
      expires_at: null,
      revoked_at: null,
      last_seen_at: null,
      created_at: '2026-07-22T10:00:00.000Z',
      updated_at: '2026-07-22T10:00:00.000Z',
      scope: 'workspace',
    });

    expect(result).toEqual({
      token: 'sf_pt_raw-created-token',
      id: '77777777-7777-4777-8777-777777777777',
      prefix: 'sf_pt_test',
      name: 'Docker provisioner',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      expiresAt: null,
      createdAt: '2026-07-22T10:00:00.000Z',
      createdByUserId: '44444444-4444-4444-8444-444444444444',
      revokedByUserId: null,
      revokedAt: null,
      lastSeenAt: null,
      updatedAt: '2026-07-22T10:00:00.000Z',
    });
  });
});

describe('toCreateTokenBody', () => {
  test('omits both optional fields for an unnamed, non-expiring command', () => {
    const result = toCreateTokenBody({expiration: {kind: 'never'}});

    expect(result).toEqual({});
  });

  test('includes name and ttl_seconds for a named, expiring command', () => {
    const result = toCreateTokenBody({
      name: 'Local runner',
      expiration: {kind: 'expires-after', seconds: 86_400},
    });

    expect(result).toEqual({name: 'Local runner', ttl_seconds: 86_400});
  });
});
