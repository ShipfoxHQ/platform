import {Text} from '@shipfox/react-ui';
import {useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {useLogoutAuth} from '#hooks/api/logout-auth.js';

export function LogoutPage() {
  const logout = useLogoutAuth();
  const navigate = useNavigate();

  useEffect(() => {
    logout.mutateAsync().finally(() => {
      navigate({to: '/auth/login', replace: true});
    });
  }, [logout.mutateAsync, navigate]);

  return (
    <AuthShell title="Logging out" description="Ending your Shipfox session.">
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        You will be sent back to login in a moment.
      </Text>
    </AuthShell>
  );
}
