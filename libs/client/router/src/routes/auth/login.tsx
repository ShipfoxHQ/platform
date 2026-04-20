import {GuestGuard, LoginPage} from '@shipfox/client-auth';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/auth/login')({
  component: () => (
    <GuestGuard>
      <LoginPage />
    </GuestGuard>
  ),
});
