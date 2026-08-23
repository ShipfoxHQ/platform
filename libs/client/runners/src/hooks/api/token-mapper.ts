import type {
  ActiveProvisionerDto,
  CreateManualRegistrationTokenResponseDto,
  CreateProvisionerTokenResponseDto,
  ListActiveProvisionersResponseDto,
  ManualRegistrationTokenDto,
  ProvisionerTokenDto,
} from '@shipfox/api-runners-dto';
import type {
  ActiveProvisioner,
  ActiveProvisionersResponse,
  CreatedManualRegistrationToken,
  CreatedProvisionerToken,
  CreateTokenCommand,
  ManualRegistrationToken,
  ProvisionerToken,
} from '#core/token.js';
export function toCreateTokenBody(command: CreateTokenCommand) {
  return {
    ...(command.name ? {name: command.name} : {}),
    ...(command.expiration.kind === 'expires-after'
      ? {ttl_seconds: command.expiration.seconds}
      : {}),
  };
}

export function toManualRegistrationToken(
  dto: ManualRegistrationTokenDto,
): ManualRegistrationToken {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    prefix: dto.prefix,
    name: dto.name,
    expiresAt: dto.expires_at,
    revokedAt: dto.revoked_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function toProvisionerToken(dto: ProvisionerTokenDto): ProvisionerToken {
  return {
    ...toManualRegistrationToken(dto),
    createdByUserId: dto.created_by_user_id,
    revokedByUserId: dto.revoked_by_user_id,
    lastSeenAt: dto.last_seen_at,
  };
}

export function toActiveProvisioner(dto: ActiveProvisionerDto): ActiveProvisioner {
  return {id: dto.id, name: dto.name, prefix: dto.prefix, lastSeenAt: dto.last_seen_at};
}

export function toActiveProvisionersResponse(
  dto: ListActiveProvisionersResponseDto,
): ActiveProvisionersResponse {
  return {
    provisioners: dto.provisioners.map(toActiveProvisioner),
    installationRunners: dto.installation_runners,
  };
}

export function toCreatedManualRegistrationToken(
  dto: CreateManualRegistrationTokenResponseDto,
): CreatedManualRegistrationToken {
  return {
    token: dto.raw_token,
    id: dto.id,
    prefix: dto.prefix,
    name: dto.name,
    workspaceId: dto.workspace_id,
    expiresAt: dto.expires_at,
    createdAt: dto.created_at,
  };
}

export function toCreatedProvisionerToken(
  dto: CreateProvisionerTokenResponseDto,
): CreatedProvisionerToken {
  return {
    ...toCreatedManualRegistrationToken(dto),
    createdByUserId: dto.created_by_user_id,
    revokedByUserId: dto.revoked_by_user_id,
    revokedAt: dto.revoked_at,
    lastSeenAt: dto.last_seen_at,
    updatedAt: dto.updated_at,
  };
}
