import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {provisionerTokenFactory} from '#test/index.js';
import {
  createInstallationProvisionerToken,
  createWorkspaceProvisionerToken,
  installationRunnersStatus,
  listUsableProvisionerTokens,
  revokeInstallationProvisionerToken,
  revokeWorkspaceProvisionerToken,
} from './provisioner-tokens.js';

describe('provisioner token core', () => {
  it('creates a workspace provisioner token and stores only the hash', async () => {
    const workspaceId = crypto.randomUUID();
    const createdByUserId = crypto.randomUUID();

    const result = await createWorkspaceProvisionerToken({
      workspaceId,
      createdByUserId,
      name: 'local provisioner',
      ttlSeconds: 3600,
    });

    expect(result.rawToken.startsWith(`sf_${tokenTypeParts.provisionerToken}_`)).toBe(true);
    expect(result.token.workspaceId).toBe(workspaceId);
    expect(result.token.createdByUserId).toBe(createdByUserId);
    expect(result.token.expiresAt).toBeInstanceOf(Date);
    expect(result.token.prefix).toBe(result.rawToken.slice(0, 12));
    const rows = await db()
      .select()
      .from(provisionerTokens)
      .where(eq(provisionerTokens.id, result.token.id));
    expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(result.rawToken));
    expect(rows[0]?.hashedToken).not.toBe(result.rawToken);
  });

  it('creates and revokes an installation provisioner token without a workspace', async () => {
    const createdByUserId = crypto.randomUUID();

    const created = await createInstallationProvisionerToken({createdByUserId, name: 'cloud'});

    expect(created.token).toMatchObject({
      scope: 'installation',
      workspaceId: null,
      createdByUserId,
    });
    const revoked = await revokeInstallationProvisionerToken({
      tokenId: created.token.id,
      revokedByUserId: crypto.randomUUID(),
    });
    expect(revoked).toMatchObject({id: created.token.id, scope: 'installation'});
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });

  it('lists usable tokens and excludes revoked tokens after revoke', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await provisionerTokenFactory.create({workspaceId});
    const revokedByUserId = crypto.randomUUID();

    const beforeRevoke = await listUsableProvisionerTokens(workspaceId);
    await revokeWorkspaceProvisionerToken({tokenId: token.id, workspaceId, revokedByUserId});
    const afterRevoke = await listUsableProvisionerTokens(workspaceId);

    expect(beforeRevoke.map((item) => item.id)).toEqual([token.id]);
    expect(afterRevoke).toEqual([]);
  });

  it('throws when revoking a token outside the workspace', async () => {
    const token = await provisionerTokenFactory.create({workspaceId: crypto.randomUUID()});

    const result = revokeWorkspaceProvisionerToken({
      tokenId: token.id,
      workspaceId: crypto.randomUUID(),
      revokedByUserId: crypto.randomUUID(),
    });

    await expect(result).rejects.toThrow(`Provisioner token not found: ${token.id}`);
  });
});

describe('installationRunnersStatus', () => {
  beforeEach(async () => {
    await db().delete(provisionerTokens).where(eq(provisionerTokens.scope, 'installation'));
  });

  it('reports managed when reserved labels are configured, without any token', async () => {
    await expect(installationRunnersStatus(['linux'])).resolves.toBe('managed');
  });

  it('reports none without reserved labels and without installation tokens', async () => {
    await expect(installationRunnersStatus([])).resolves.toBe('none');
  });

  it('reports managed when an installation token is active', async () => {
    await provisionerTokenFactory.create({scope: 'installation'});

    await expect(installationRunnersStatus([])).resolves.toBe('managed');
  });

  it('reports none when the only installation token has expired', async () => {
    await provisionerTokenFactory.create({
      scope: 'installation',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(installationRunnersStatus([])).resolves.toBe('none');
  });

  it('reports none when the only installation token is revoked', async () => {
    const token = await provisionerTokenFactory.create({scope: 'installation'});
    await revokeInstallationProvisionerToken({
      tokenId: token.id,
      revokedByUserId: crypto.randomUUID(),
    });

    await expect(installationRunnersStatus([])).resolves.toBe('none');
  });

  it('ignores workspace-scope tokens', async () => {
    await provisionerTokenFactory.create({workspaceId: crypto.randomUUID()});

    await expect(installationRunnersStatus([])).resolves.toBe('none');
  });
});
