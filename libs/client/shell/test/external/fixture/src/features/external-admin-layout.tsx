import {Link, Outlet} from '@tanstack/react-router';
import {useLayoutNavigation} from '@shipfox/client-shell/runtime';
import {defineRoute} from '@shipfox/client-shell/runtime';

function ExternalAdminLayout() {
  const entries = useLayoutNavigation('fixture.admin-layout');
  return (
    <>
      <nav aria-label="External administration sections">
        {entries.map((entry) => (
          <Link key={entry.id} to={entry.to as never}>
            {entry.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

export default defineRoute({component: ExternalAdminLayout});
