import {Header, Text} from '@shipfox/react-ui';
import {createRootRoute, Link, Outlet} from '@tanstack/react-router';

function NotFoundPage() {
  return (
    <main className="mx-auto max-w-[960px] px-24 py-48">
      <Header variant="h1">Page not found</Header>
      <Text size="md" className="text-foreground-neutral-muted">
        This Shipfox page does not exist.
      </Text>
      <Link to="/">Go home</Link>
    </main>
  );
}

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});
