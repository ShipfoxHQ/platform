import {GuestGuard, VerifyEmailPage} from '@shipfox/client-auth';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/auth/verify-email')({
  component: () => (
    <GuestGuard>
      <VerifyEmailPage />
    </GuestGuard>
  ),
});
