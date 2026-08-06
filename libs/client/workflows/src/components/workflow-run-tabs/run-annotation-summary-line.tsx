import {MetadataSeparator} from '@shipfox/client-ui';
import {Icon} from '@shipfox/react-ui/icon';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {
  type WorkflowRunAnnotationSeverity,
  type WorkflowRunsSearch,
  workflowRunSearchParams,
} from '#routes/inputs.js';
import {SEVERITY_ICON, SEVERITY_ICON_TONE} from './severity-visuals.js';

/**
 * The severities this line names.
 *
 * The line exists so a failing run cannot look clean while the explanation sits behind an
 * inactive section, which makes its subject "what needs attention", not "what happened".
 * `info` and `success` are already inside the total, and repeating them gives "nothing is
 * wrong" the same weight and the same accent as "something failed".
 */
const ATTENTION_SEVERITIES = [
  'error',
  'warning',
] as const satisfies readonly WorkflowRunAnnotationSeverity[];

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
  // A run with no annotations says so in its empty state; a "0 annotations" line beside it is
  // the same fact twice.
  if (!summary || summary.total === 0) return null;

  const visibleSeverities = ATTENTION_SEVERITIES.filter((severity) => summary[severity] > 0);

  const totalLabel = countLabel(summary.total, 'annotation', summary.truncated);

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 text-foreground-neutral-subtle">
      {search.severity && workspaceSlug && projectSlug && workflowRunId ? (
        // The severity filter has no control of its own, so while one is active the total is
        // the way back out. Unfiltered it stays plain text: a link to where you already are
        // is noise.
        <Link
          to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
          params={{workspaceSlug, projectSlug, workflowRunId}}
          search={
            workflowRunSearchParams(
              {...withoutSeverity(search), tab: 'annotations'},
              search,
            ) as never
          }
          aria-label={`Show all ${totalLabel}`}
          className="shrink-0 rounded-4 outline-none focus-visible:shadow-border-interactive-with-active"
        >
          {/* Underlined rather than accented: the escape hatch has to read as a link without
              becoming the loudest thing on a line whose job is to be scannable. */}
          <Text as="span" size="xs" className="text-foreground-neutral-subtle underline">
            {totalLabel}
          </Text>
        </Link>
      ) : (
        <Text as="span" size="xs" className="shrink-0 text-foreground-neutral-subtle">
          {totalLabel}
        </Text>
      )}
      {visibleSeverities.map((severity) => (
        <span key={severity} className="inline-flex shrink-0 items-center gap-8">
          <MetadataSeparator />
          <SeverityLink
            count={summary[severity]}
            truncated={summary.truncated}
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
  truncated,
  severity,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search,
}: {
  count: number;
  truncated: boolean;
  severity: WorkflowRunAnnotationSeverity;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  search: WorkflowRunsSearch;
}) {
  const label = countLabel(count, severity, truncated);
  const content = (
    <>
      <Icon
        name={SEVERITY_ICON[severity]}
        size={12}
        aria-hidden="true"
        className={cn('shrink-0', SEVERITY_ICON_TONE[severity])}
      />
      <Text as="span" size="xs" className="text-foreground-neutral-subtle">
        {label}
      </Text>
    </>
  );

  if (!workspaceSlug || !projectSlug || !workflowRunId) {
    return <span className="inline-flex items-center gap-4">{content}</span>;
  }

  const searchWithoutAnnotation = withoutAnnotation(search);

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
      className="inline-flex items-center gap-4 rounded-4 outline-none hover:underline focus-visible:shadow-border-interactive-with-active"
    >
      {content}
    </Link>
  );
}

/** A selected annotation is stale the moment the list it was chosen from is refiltered. */
function withoutAnnotation(search: WorkflowRunsSearch): WorkflowRunsSearch {
  const next = {...search};
  delete next.annotation;
  return next;
}

function withoutSeverity(search: WorkflowRunsSearch): WorkflowRunsSearch {
  const next = withoutAnnotation(search);
  delete next.severity;
  return next;
}

/**
 * A truncated read renders `500+ annotations`: the counts are a lower bound once the page budget
 * is hit, and presenting them as exact would understate a run the reader is trying to trust.
 */
function countLabel(count: number, word: string, truncated: boolean): string {
  const plural = count === 1 && !truncated ? word : `${word}s`;
  return `${count}${truncated ? '+' : ''} ${plural}`;
}
