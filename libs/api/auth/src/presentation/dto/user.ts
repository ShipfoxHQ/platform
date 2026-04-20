import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import type {User} from '#core/entities/user.js';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    email_verified_at: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    status: user.status,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

export function toAuthSessionDto(result: {token: string; user: User}): LoginResponseDto {
  return {
    token: result.token,
    user: toUserDto(result.user),
  };
}
