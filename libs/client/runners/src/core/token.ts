export interface ManualRegistrationToken {
  id: string;
  workspaceId: string;
  prefix: string;
  name: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionerToken extends ManualRegistrationToken {
  createdByUserId: string;
  revokedByUserId: string | null;
  lastSeenAt: string | null;
}

export interface ActiveProvisioner {
  id: string;
  name: string | null;
  prefix: string;
  lastSeenAt: string;
}

export type InstallationRunnersStatus = 'managed' | 'none';

export interface ActiveProvisioners extends Array<ActiveProvisioner> {
  installationRunners: InstallationRunnersStatus;
}

export interface CreatedManualRegistrationToken {
  token: string;
  id: string;
  prefix: string;
  name: string | null;
  workspaceId: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreatedProvisionerToken extends CreatedManualRegistrationToken {
  createdByUserId: string;
  revokedByUserId: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
}

export type TokenExpiration = {kind: 'never'} | {kind: 'expires-after'; seconds: number};

export interface CreateTokenCommand {
  name?: string;
  expiration: TokenExpiration;
}

export type ProvisionerConnectionStatus =
  | {kind: 'connected'; dotVariant: 'success'; label: 'Connected'}
  | {kind: 'last-seen'; dotVariant: 'neutral'; label: 'Last seen'; lastSeenAt: string}
  | {kind: 'never-connected'; dotVariant: 'neutral'; label: 'Never connected'};

export function createTokenCommand(name: string, expiration: TokenExpiration): CreateTokenCommand {
  const trimmedName = name.trim();
  return {expiration, ...(trimmedName ? {name: trimmedName} : {})};
}

export function tokenDisplayName(token: Pick<ManualRegistrationToken, 'name'>): string {
  return token.name || 'Unnamed token';
}

export function provisionerTokenDisplayName(token: Pick<ProvisionerToken, 'name'>): string {
  return token.name || 'Unnamed provisioner';
}

export function provisionerConnectionStatus(
  token: Pick<ProvisionerToken, 'id' | 'lastSeenAt'>,
  activeIds: ReadonlySet<string>,
): ProvisionerConnectionStatus {
  if (activeIds.has(token.id))
    return {kind: 'connected', dotVariant: 'success', label: 'Connected'};
  if (token.lastSeenAt) {
    return {
      kind: 'last-seen',
      dotVariant: 'neutral',
      label: 'Last seen',
      lastSeenAt: token.lastSeenAt,
    };
  }
  return {kind: 'never-connected', dotVariant: 'neutral', label: 'Never connected'};
}
