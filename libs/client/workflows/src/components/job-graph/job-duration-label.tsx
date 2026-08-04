import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Code} from '@shipfox/react-ui/typography';
import {humanDuration} from '@shipfox/react-ui/utils';
import type {JobDisplayDuration} from '#core/workflow-run.js';
import {formatJobExecutionTimeLabel} from './job-duration-format.js';

export function JobDurationLabel({duration}: {duration: JobDisplayDuration | null}) {
  if (duration === null) return null;

  if (duration.state === 'live') {
    return <LiveDurationText fromIso={duration.fromIso} />;
  }

  return <DurationText>{formatJobExecutionTimeLabel(duration)}</DurationText>;
}

function LiveDurationText({fromIso}: {fromIso: string}) {
  useTimeTick();
  return <DurationText>{humanDuration(fromIso)}</DurationText>;
}

function DurationText({children}: {children: string}) {
  // The status icon names the state; the node aria-label carries the verb.
  return (
    <Code
      as="span"
      variant="label"
      className="shrink-0 tabular-nums text-foreground-neutral-subtle"
    >
      {children}
    </Code>
  );
}
