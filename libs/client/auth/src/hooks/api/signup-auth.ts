import type {SignupBodyDto, SignupResponseDto} from '@shipfox/api-auth-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';

async function signupAuth(body: SignupBodyDto) {
  return await apiRequest<SignupResponseDto>('/auth/signup', {method: 'POST', body});
}

export function useSignupAuth() {
  return useMutation({mutationFn: signupAuth});
}
