import {LogoutPage} from '@shipfox/client-auth';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/auth/logout')({
  component: LogoutPage,
});
