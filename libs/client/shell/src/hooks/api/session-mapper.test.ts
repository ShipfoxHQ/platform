import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import type {AdminRole} from '#core/session.js';
import {toAuthenticatedSession, toUserIdentity} from './session-mapper.js';

type Exact<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
    ? (<Type>() => Type extends Right ? 1 : 2) extends <Type>() => Type extends Left ? 1 : 2
      ? true
      : false
    : false;

const baseUser: UserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: null,
  email_verified_at: null,
  status: 'active',
  created_at: '2026-04-27T00:00:00.000Z',
  updated_at: '2026-04-27T00:00:00.000Z',
};

describe('toUserIdentity', () => {
  test('omits name and emailVerifiedAt when the DTO carries neither', () => {
    expect(toUserIdentity(baseUser)).toEqual({id: baseUser.id, email: baseUser.email});
  });

  test('maps name and email_verified_at into camelCase when present', () => {
    const identity = toUserIdentity({
      ...baseUser,
      name: 'Ada',
      email_verified_at: '2026-04-27T00:00:00.000Z',
    });

    expect(identity).toEqual({
      id: baseUser.id,
      email: baseUser.email,
      name: 'Ada',
      emailVerifiedAt: '2026-04-27T00:00:00.000Z',
    });
  });
});

describe('toAuthenticatedSession', () => {
  test('keeps the client role model aligned with the Auth DTO role model', () => {
    const roleTypeContract: Exact<AdminRole, NonNullable<LoginResponseDto['admin_role']>> = true;

    expect(roleTypeContract).toBe(true);
  });

  test('maps the token to accessToken and the user through toUserIdentity', () => {
    const dto: LoginResponseDto = {token: 'access-token', user: baseUser};

    expect(toAuthenticatedSession(dto)).toEqual({
      accessToken: 'access-token',
      user: {id: baseUser.id, email: baseUser.email},
    });
  });

  test('maps the current admin role separately from the user identity token claims', () => {
    const dto: LoginResponseDto = {
      token: 'access-token',
      user: baseUser,
      admin_role: 'admin-owner',
    };

    expect(toAuthenticatedSession(dto).user.adminRole).toBe('admin-owner');
  });
});
