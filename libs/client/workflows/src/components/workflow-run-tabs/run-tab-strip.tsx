import {TabsList, TabsTrigger} from '@shipfox/react-ui/tabs';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import {RunTabCount} from './run-tab-count.js';

export interface RunTabStripProps {
  jobCount?: number | undefined;
  jobsFailed?: number | undefined;
  annotationSummary?: RunAnnotationSummary | undefined;
}

export function RunTabStrip({jobCount, jobsFailed = 0, annotationSummary}: RunTabStripProps) {
  const annotationCount = annotationSummary?.total;
  const annotationErrors = annotationSummary?.error ?? 0;

  return (
    <div className="min-w-0 overflow-x-auto border-b border-border-neutral-base bg-background-neutral-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <TabsList
        aria-label="Run sections"
        className="h-40 min-h-40 w-max min-w-full gap-16 px-16 [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
      >
        <TabsTrigger
          value="summary"
          className="h-40 min-h-40 py-0 text-xs data-[state=inactive]:text-foreground-neutral-subtle data-[state=inactive]:hover:text-foreground-neutral-base [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
        >
          Summary
        </TabsTrigger>
        <TabsTrigger
          value="jobs"
          aria-label={runTabAccessibleName({
            label: 'Jobs',
            total: jobCount,
            totalSingular: 'job',
            totalPlural: 'jobs',
            alertCount: jobsFailed,
            alertSingular: 'failed',
            alertPlural: 'failed',
          })}
          className="h-40 min-h-40 gap-6 py-0 text-xs data-[state=inactive]:text-foreground-neutral-subtle data-[state=inactive]:hover:text-foreground-neutral-base [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
        >
          <span>Jobs</span>
          <RunTabCount count={jobCount} alertCount={jobsFailed} alertLabel="failed" />
        </TabsTrigger>
        <TabsTrigger
          value="annotations"
          aria-label={runTabAccessibleName({
            label: 'Annotations',
            total: annotationCount,
            totalSingular: 'annotation',
            totalPlural: 'annotations',
            alertCount: annotationErrors,
            alertSingular: 'error',
            alertPlural: 'errors',
          })}
          className="h-40 min-h-40 gap-6 py-0 text-xs data-[state=inactive]:text-foreground-neutral-subtle data-[state=inactive]:hover:text-foreground-neutral-base [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
        >
          <span>Annotations</span>
          <RunTabCount
            count={annotationCount}
            alertCount={annotationErrors}
            alertLabel={annotationErrors === 1 ? 'error' : 'errors'}
          />
        </TabsTrigger>
        <TabsTrigger
          value="source"
          className="h-40 min-h-40 py-0 text-xs data-[state=inactive]:text-foreground-neutral-subtle data-[state=inactive]:hover:text-foreground-neutral-base [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
        >
          Source
        </TabsTrigger>
      </TabsList>
    </div>
  );
}

function runTabAccessibleName({
  label,
  total,
  totalSingular,
  totalPlural,
  alertCount,
  alertSingular,
  alertPlural,
}: {
  label: string;
  total: number | undefined;
  totalSingular: string;
  totalPlural: string;
  alertCount: number;
  alertSingular: string;
  alertPlural: string;
}): string {
  const parts = [label];

  if (total !== undefined) parts.push(`${total} ${total === 1 ? totalSingular : totalPlural}`);
  if (alertCount > 0) parts.push(`${alertCount} ${alertCount === 1 ? alertSingular : alertPlural}`);

  return parts.join(', ');
}
