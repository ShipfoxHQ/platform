import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import type {MembershipWithWorkspaceDto} from '@shipfox/api-workspaces-dto';
import {atom} from 'jotai';

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

export interface Workspace {
  id: string;
  name: string;
  membershipId: string;
}

export interface AuthState {
  status: AuthStatus;
  token?: string;
  user?: UserDto;
  workspaces?: Workspace[];
}

export interface AuthFormDraft {
  email: string;
  password: string;
}

export const initialAuthState: AuthState = {status: 'loading'};
export const initialAuthFormDraft: AuthFormDraft = {email: '', password: ''};

export const authStateAtom = atom<AuthState>(initialAuthState);
export const authFormDraftAtom = atom<AuthFormDraft>(initialAuthFormDraft);

export function toAuthenticatedState(
  result: LoginResponseDto,
  memberships: MembershipWithWorkspaceDto[] = [],
): AuthState {
  return {
    status: 'authenticated',
    token: result.token,
    user: result.user,
    workspaces: memberships.map((membership) => ({
      id: membership.workspace_id,
      name: membership.workspace_name,
      membershipId: membership.id,
    })),
  };
}
