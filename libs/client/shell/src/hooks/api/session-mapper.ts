import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import type {AuthenticatedSession, UserIdentity} from '#core/session.js';

export function toUserIdentity(dto: UserDto): UserIdentity {
  return {
    id: dto.id,
    email: dto.email,
    ...(dto.name ? {name: dto.name} : {}),
    ...(dto.email_verified_at ? {emailVerifiedAt: dto.email_verified_at} : {}),
  };
}

export function toAuthenticatedSession(dto: LoginResponseDto): AuthenticatedSession {
  return {
    accessToken: dto.token,
    user: {
      ...toUserIdentity(dto.user),
      ...(dto.admin_role ? {adminRole: dto.admin_role} : {}),
    },
  };
}
