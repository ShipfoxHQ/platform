import {GuestGuard, PasswordResetPage} from '@shipfox/client-auth';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/auth/reset')({
  component: () => (
    <GuestGuard>
      <PasswordResetPage />
    </GuestGuard>
  ),
});
