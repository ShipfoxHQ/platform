import {Badge} from '@shipfox/react-ui/badge';

export function RunTabCount({
  count,
  hasFailures,
}: {
  count: number | undefined;
  hasFailures: boolean;
}) {
  if (count === undefined) return null;

  return (
    <Badge size="2xs" variant={hasFailures ? 'error' : 'neutral'} aria-hidden="true">
      {count}
    </Badge>
  );
}
