import {toast} from '@shipfox/react-ui';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect} from 'react';
import {useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {useVerifyEmailAuth} from '#hooks/api/verify-email-auth.js';
import {authErrorMessage} from './form-utils.js';

const verificationRequests = new Map<string, Promise<void>>();
const toastedVerificationTokens = new Set<string>();

export function VerifyEmailPage() {
  const verifyEmail = useVerifyEmailAuth();
  const refreshAuth = useRefreshAuth();
  const navigate = useNavigate();
  const search = useSearch({strict: false});
  const token = typeof search.token === 'string' ? search.token : undefined;

  useEffect(() => {
    if (!token) {
      toast.error('This verification link is missing a token.');
      navigate({to: '/', replace: true});
      return;
    }

    let request = verificationRequests.get(token);
    if (!request) {
      request = verifyEmail.mutateAsync({token}).then(async () => {
        await refreshAuth();
      });
      verificationRequests.set(token, request);
    }

    request
      .then(() => {
        if (toastedVerificationTokens.has(token)) return;
        toastedVerificationTokens.add(token);
        toast.success('Your email is verified. You are now logged in.');
        navigate({to: '/', replace: true});
      })
      .catch((error) => {
        if (toastedVerificationTokens.has(token)) return;
        toastedVerificationTokens.add(token);
        toast.error(authErrorMessage(error));
      });
  }, [navigate, refreshAuth, token, verifyEmail.mutateAsync]);

  return null;
}
