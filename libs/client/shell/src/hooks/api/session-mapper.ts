import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import type {AuthenticatedSession, UserIdentity} from '#core/session.js';

/**
 * A session response that may carry the optional impersonation mark. The
 * cookie-based login and refresh responses never set it; an externally minted
 * session response does.
 */
export interface SessionResponseDto extends LoginResponseDto {
  impersonator_id?: string;
}

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
