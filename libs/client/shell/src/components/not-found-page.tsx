import {Header, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-[960px] px-frame py-[48px]">
      <Header variant="h1">Page not found</Header>
      <Text size="md" className="text-foreground-neutral-muted">
        This Shipfox page does not exist.
      </Text>
      <Link to="/">Go home</Link>
    </main>
  );
}
