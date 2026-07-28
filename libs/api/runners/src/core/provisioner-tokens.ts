import {createHmac} from 'node:crypto';
import type {AdministrationRole} from '@shipfox/api-common-dto';
import {createAdministrationActionEvent} from '@shipfox/api-common-dto';
import {runnerSessionTokenKey} from '@shipfox/node-auth-root-key';
import type {TimestampIdCursor} from '@shipfox/node-drizzle';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createInstallationProvisionerTokenWithAudit,
  createProvisionerToken,
  listActiveProvisionerTokens,
  listInstallationProvisionerTokens,
  listUsableProvisionerTokensByWorkspaceId,
  revokeInstallationProvisionerToken as revokeInstallationProvisionerTokenDb,
  revokeInstallationProvisionerTokenWithAudit,
  revokeProvisionerToken,
} from '#db/provisioner-tokens.js';
import {config} from '../config.js';
import type {ActiveProvisionerToken, ProvisionerToken} from './entities/provisioner-token.js';
import {
  ProvisionerAdminIdempotencyReplayUnavailableError,
  ProvisionerTokenNotFoundError,
} from './errors.js';

export interface CreateWorkspaceProvisionerTokenParams {
  workspaceId: string;
  createdByUserId: string;
  name?: string | undefined;
  ttlSeconds?: number | undefined;
}

export interface CreateWorkspaceProvisionerTokenResult {
  token: ProvisionerToken;
  rawToken: string;
}

export async function createWorkspaceProvisionerToken(
  params: CreateWorkspaceProvisionerTokenParams,
): Promise<CreateWorkspaceProvisionerTokenResult> {
  const rawToken = generateOpaqueToken('provisionerToken');
  const expiresAt = params.ttlSeconds ? new Date(Date.now() + params.ttlSeconds * 1000) : undefined;

  const token = await createProvisionerToken({
    scope: 'workspace',
    workspaceId: params.workspaceId,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: params.name,
    createdByUserId: params.createdByUserId,
    expiresAt,
  });

  return {token, rawToken};
}

export interface CreateInstallationProvisionerTokenParams {
  createdByUserId: string;
  name?: string | undefined;
  ttlSeconds?: number | undefined;
}

export async function createInstallationProvisionerToken(
  params: CreateInstallationProvisionerTokenParams,
): Promise<CreateWorkspaceProvisionerTokenResult> {
  const rawToken = generateOpaqueToken('provisionerToken');
  const expiresAt = params.ttlSeconds ? new Date(Date.now() + params.ttlSeconds * 1000) : undefined;
  const token = await createProvisionerToken({
    scope: 'installation',
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: params.name,
    createdByUserId: params.createdByUserId,
    expiresAt,
  });
  return {token, rawToken};
}

export function listUsableProvisionerTokens(workspaceId: string): Promise<ProvisionerToken[]> {
  return listUsableProvisionerTokensByWorkspaceId(workspaceId);
}

export function listActiveProvisioners(workspaceId: string): Promise<ActiveProvisionerToken[]> {
  return listActiveProvisionerTokens({
    workspaceId,
    windowSeconds: config.PROVISIONER_ACTIVE_WINDOW_SECONDS,
  });
}

export async function revokeWorkspaceProvisionerToken(params: {
  tokenId: string;
  workspaceId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken> {
  const token = await revokeProvisionerToken(params);
  if (!token) throw new ProvisionerTokenNotFoundError(params.tokenId);
  return token;
}

export async function revokeInstallationProvisionerToken(params: {
  tokenId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken> {
  const token = await revokeInstallationProvisionerTokenDb(params);
  if (!token) throw new ProvisionerTokenNotFoundError(params.tokenId);
  return token;
}

const ADMIN_OWNER_ROLE: AdministrationRole = 'admin-owner';
const ADMIN_OPERATOR_ROLE: AdministrationRole = 'admin-operator';
const CREATE_ADMIN_COMMAND = 'runners.provisioner_token.create';
const REVOKE_ADMIN_COMMAND = 'runners.provisioner_token.revoke';

export interface InstallationProvisionerTokenAdministrationContext {
  actorId: string;
  actorRole: AdministrationRole;
  idempotencyKey: string;
  correlationId: string;
  reason: string;
}

function administrationCommandFingerprint(command: string, input: unknown): string {
  return hashOpaqueToken(`${command}:${JSON.stringify(input)}`);
}

function idempotentProvisionerToken(seed: string): string {
  const generated = generateOpaqueToken('provisionerToken');
  const tokenPrefix = generated.slice(0, -43);
  const key = createHmac('sha256', runnerSessionTokenKey())
    .update('shipfox/provisioner-token-idempotency/v1')
    .digest();
  const suffix = createHmac('sha256', key).update(seed).digest('base64url');
  return `${tokenPrefix}${suffix}`;
}

function administrationEvent(params: {
  actorId: string;
  actorRole: AdministrationRole;
  requiredRole: AdministrationRole;
  command: string;
  targetId: string;
  reason: string;
  correlationId: string;
  idempotencyKeyFingerprint: string;
}) {
  return createAdministrationActionEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    requiredRole: params.requiredRole,
    command: params.command,
    targetType: 'provisioner-token',
    targetId: params.targetId,
    reason: params.reason,
    result: 'succeeded',
    correlationId: params.correlationId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    occurredAt: new Date().toISOString(),
  });
}

export type InstallationProvisionerTokenStatus = 'active' | 'expired' | 'revoked';

export function installationProvisionerTokenStatus(
  token: ProvisionerToken,
  now = new Date(),
): InstallationProvisionerTokenStatus {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && token.expiresAt <= now) return 'expired';
  return 'active';
}

export async function listAdministratorInstallationProvisionerTokens(params: {
  limit: number;
  cursor?: TimestampIdCursor | undefined;
  status?: InstallationProvisionerTokenStatus | undefined;
}) {
  return await listInstallationProvisionerTokens(params);
}

export async function createAdministratorInstallationProvisionerToken(
  params: InstallationProvisionerTokenAdministrationContext & {
    name?: string | undefined;
    ttlSeconds?: number | undefined;
  },
): Promise<{token: ProvisionerToken; rawToken: string; correlationId: string}> {
  const idempotencyKeyFingerprint = hashOpaqueToken(params.idempotencyKey);
  const requestFingerprint = administrationCommandFingerprint(CREATE_ADMIN_COMMAND, {
    name: params.name,
    ttlSeconds: params.ttlSeconds,
    reason: params.reason,
  });
  const rawToken = idempotentProvisionerToken(
    `${params.actorId}:${params.idempotencyKey}:${requestFingerprint}`,
  );
  const result = await createInstallationProvisionerTokenWithAudit({
    actorId: params.actorId,
    command: CREATE_ADMIN_COMMAND,
    correlationId: params.correlationId,
    idempotencyKeyFingerprint,
    requestFingerprint,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: params.name,
    ttlSeconds: params.ttlSeconds,
    event: (tokenId) =>
      administrationEvent({
        actorId: params.actorId,
        actorRole: params.actorRole,
        requiredRole: ADMIN_OWNER_ROLE,
        command: CREATE_ADMIN_COMMAND,
        targetId: tokenId,
        reason: params.reason,
        correlationId: params.correlationId,
        idempotencyKeyFingerprint,
      }),
  });
  if (result.replayed && hashOpaqueToken(rawToken) !== result.token.hashedToken) {
    throw new ProvisionerAdminIdempotencyReplayUnavailableError();
  }
  return {...result, rawToken, correlationId: result.correlationId};
}

export async function revokeAdministratorInstallationProvisionerToken(
  params: InstallationProvisionerTokenAdministrationContext & {tokenId: string},
): Promise<{token: ProvisionerToken; correlationId: string}> {
  const idempotencyKeyFingerprint = hashOpaqueToken(params.idempotencyKey);
  const requestFingerprint = administrationCommandFingerprint(REVOKE_ADMIN_COMMAND, {
    tokenId: params.tokenId,
    reason: params.reason,
  });
  const result = await revokeInstallationProvisionerTokenWithAudit({
    tokenId: params.tokenId,
    actorId: params.actorId,
    command: REVOKE_ADMIN_COMMAND,
    correlationId: params.correlationId,
    idempotencyKeyFingerprint,
    requestFingerprint,
    event: (tokenId) =>
      administrationEvent({
        actorId: params.actorId,
        actorRole: params.actorRole,
        requiredRole: ADMIN_OPERATOR_ROLE,
        command: REVOKE_ADMIN_COMMAND,
        targetId: tokenId,
        reason: params.reason,
        correlationId: params.correlationId,
        idempotencyKeyFingerprint,
      }),
  });
  if (!result) throw new ProvisionerTokenNotFoundError(params.tokenId);
  return result;
}
