import {Badge} from '@shipfox/react-ui/badge';

export function RunTabCount({
  count,
  alertCount = 0,
  alertLabel,
}: {
  count: number | undefined;
  alertCount?: number | undefined;
  alertLabel: string;
}) {
  if (count === undefined && alertCount <= 0) return null;

  return (
    <>
      {count === undefined ? null : (
        <Badge size="2xs" variant="neutral" aria-hidden="true">
          {count}
        </Badge>
      )}
      {alertCount > 0 ? (
        <Badge size="2xs" variant="error" aria-hidden="true">
          {alertCount} {alertLabel}
        </Badge>
      ) : null}
    </>
  );
}
