import {ScrollArea} from '@shipfox/react-ui/scroll-area';
import {Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {
  groupRunAnnotationsByExecution,
  type RunAnnotation,
  type RunAnnotationExecutionGroup,
} from '#core/run-annotation.js';
import type {Job} from '#core/workflow-run.js';
import {AnnotationCardBlock} from './annotation-card-block.js';

export function RunAnnotationsPanel({
  annotations,
  jobs,
}: {
  annotations: readonly RunAnnotation[];
  jobs: readonly Job[];
}) {
  const groups = useMemo(
    () => groupRunAnnotationsByExecution(annotations, jobs),
    [annotations, jobs],
  );

  if (groups.length === 0) return null;

  return (
    <section
      aria-label="Run annotations"
      className="flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-components-base"
    >
      <div className="flex min-h-44 items-center justify-between gap-12 px-16 py-10">
        <Text as="h2" size="sm" bold className="text-foreground-neutral-base">
          Run annotations
        </Text>
        <Text as="span" size="xs" className="font-code text-foreground-neutral-muted">
          {annotations.length}
        </Text>
      </div>
      <div className="relative min-h-0 border-t border-border-neutral-strong">
        <ScrollArea className="max-h-320">
          <div className="flex min-w-0 flex-col gap-16 px-16 py-12">
            {groups.map((group) => (
              <RunAnnotationGroup key={group.jobExecution.id} group={group} />
            ))}
          </div>
        </ScrollArea>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background-components-base"
        />
      </div>
    </section>
  );
}

function RunAnnotationGroup({group}: {group: RunAnnotationExecutionGroup}) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex min-w-0 items-center gap-6">
        <WorkflowStatusIcon status={group.jobExecution.status} size={14} tooltip={false} />
        <Text as="span" size="sm" className="min-w-0 truncate text-foreground-neutral-muted">
          {jobExecutionLabel(group)}
        </Text>
      </div>
      <div className="flex min-w-0 flex-col gap-8">
        {group.annotations.map((annotation) => (
          <AnnotationCardBlock key={annotation.id} annotation={annotation} />
        ))}
      </div>
    </div>
  );
}

function jobExecutionLabel({job, jobExecution}: RunAnnotationExecutionGroup): string {
  if (job.jobExecutions.length <= 1) return job.displayName;
  return `${job.displayName} #${jobExecution.sequence}`;
}
