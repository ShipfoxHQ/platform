import {TabsList, TabsTrigger} from '@shipfox/react-ui/tabs';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import type {WorkflowRunsSearch} from '#routes/inputs.js';
import {RunAnnotationSummaryLine} from './run-annotation-summary-line.js';
import {RunTabCount} from './run-tab-count.js';

export interface RunTabStripProps {
  jobCount?: number | undefined;
  jobsFailed?: number | undefined;
  annotationSummary?: RunAnnotationSummary | undefined;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  search?: WorkflowRunsSearch | undefined;
}

export function RunTabStrip({
  jobCount,
  jobsFailed = 0,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search,
}: RunTabStripProps) {
  const annotationCount = annotationSummary?.total;

  return (
    <div className="flex min-w-0 flex-col border-b border-border-neutral-base bg-background-subtle-base min-[768px]:min-h-32 min-[768px]:flex-row min-[768px]:items-center">
      <div className="order-2 min-w-0 flex-1 overflow-x-auto min-[768px]:order-1">
        <TabsList
          aria-label="Run sections"
          activeClassName="h-1"
          className="h-32 min-h-32 gap-12 overflow-x-auto px-16 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
        >
          <TabsTrigger
            value="summary"
            className="h-32 min-h-32 py-0 text-xs [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
          >
            Summary
          </TabsTrigger>
          <TabsTrigger
            value="jobs"
            aria-label={
              jobCount === undefined
                ? 'Jobs'
                : `Jobs, ${jobCount} ${jobCount === 1 ? 'job' : 'jobs'}`
            }
            className="h-32 min-h-32 gap-6 py-0 text-xs [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
          >
            <span>Jobs</span>
            <span className="inline-flex min-w-24 justify-center">
              <RunTabCount count={jobCount} hasFailures={jobsFailed > 0} />
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="annotations"
            aria-label={
              annotationCount === undefined
                ? 'Annotations'
                : `Annotations, ${annotationCount} ${annotationCount === 1 ? 'annotation' : 'annotations'}`
            }
            className="h-32 min-h-32 gap-6 py-0 text-xs [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
          >
            <span>Annotations</span>
            <span className="inline-flex min-w-24 justify-center">
              <RunTabCount
                count={annotationCount}
                hasFailures={(annotationSummary?.error ?? 0) > 0}
              />
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="source"
            className="h-32 min-h-32 py-0 text-xs [@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:min-h-44"
          >
            Source
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="order-1 min-w-0 min-[768px]:order-2 min-[768px]:shrink-0 min-[768px]:pr-16">
        <RunAnnotationSummaryLine
          summary={annotationSummary}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          workflowRunId={workflowRunId}
          search={search}
        />
      </div>
    </div>
  );
}
