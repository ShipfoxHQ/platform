import {GuestGuard, SignupPage} from '@shipfox/client-auth';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/auth/signup')({
  component: () => (
    <GuestGuard>
      <SignupPage />
    </GuestGuard>
  ),
});
