import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import {
  WORKFLOW_RUN_ANNOTATION_SEVERITIES,
  type WorkflowRunAnnotationSeverity,
  type WorkflowRunsSearch,
  workflowRunSearchParams,
} from '#routes/inputs.js';
import {MetadataSeparator} from '../workflow-run-summary/workflow-run-summary.js';

export interface RunAnnotationSummaryLineProps {
  summary?: RunAnnotationSummary | undefined;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  search?: WorkflowRunsSearch | undefined;
}

export function RunAnnotationSummaryLine({
  summary,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search = {},
}: RunAnnotationSummaryLineProps) {
  if (!summary) return null;

  const visibleSeverities = WORKFLOW_RUN_ANNOTATION_SEVERITIES.filter(
    (severity) => summary[severity] > 0,
  );

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 text-foreground-neutral-subtle">
      <Text as="span" size="xs" className="shrink-0 text-foreground-neutral-subtle">
        {summary.total} {pluralize('annotation', summary.total)}
      </Text>
      {visibleSeverities.map((severity) => (
        <span key={severity} className="inline-flex shrink-0 items-center gap-8">
          <MetadataSeparator />
          <SeverityLink
            count={summary[severity]}
            severity={severity}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={workflowRunId}
            search={search}
          />
        </span>
      ))}
    </div>
  );
}

function SeverityLink({
  count,
  severity,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search,
}: {
  count: number;
  severity: WorkflowRunAnnotationSeverity;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  search: WorkflowRunsSearch;
}) {
  const label = `${count} ${pluralize(severity, count)}`;
  if (!workspaceSlug || !projectSlug || !workflowRunId) {
    return <span className="text-foreground-highlight-interactive">{label}</span>;
  }

  const searchWithoutAnnotation = {...search};
  delete searchWithoutAnnotation.annotation;

  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{workspaceSlug, projectSlug, workflowRunId}}
      search={
        workflowRunSearchParams(
          {...searchWithoutAnnotation, tab: 'annotations', severity},
          search,
        ) as never
      }
      className="text-foreground-highlight-interactive outline-none hover:underline focus-visible:shadow-border-interactive-with-active"
    >
      {label}
    </Link>
  );
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
