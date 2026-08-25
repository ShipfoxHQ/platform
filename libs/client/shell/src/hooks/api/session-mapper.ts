import type {SessionResponseDto, UserDto} from '@shipfox/api-auth-dto';
import type {AuthenticatedSession, UserIdentity} from '#core/session.js';

export type {SessionResponseDto};

export function toUserIdentity(dto: UserDto): UserIdentity {
  return {
    id: dto.id,
    email: dto.email,
    ...(dto.name ? {name: dto.name} : {}),
    ...(dto.email_verified_at ? {emailVerifiedAt: dto.email_verified_at} : {}),
  };
}

export function toAuthenticatedSession(dto: SessionResponseDto): AuthenticatedSession {
  return {
    accessToken: dto.token,
    user: {
      ...toUserIdentity(dto.user),
      ...(dto.admin_role ? {adminRole: dto.admin_role} : {}),
    },
    ...(dto.impersonator_id ? {impersonatorId: dto.impersonator_id} : {}),
  };
}
