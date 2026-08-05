import {Icon} from '@shipfox/react-ui/icon';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {highestRunAnnotationSeverity, type RunAnnotationSummary} from '#core/run-annotation.js';
import {type WorkflowRunsSearch, workflowRunSearchParams} from '#routes/inputs.js';
import {SEVERITY_CHIP_TONE, SEVERITY_ICON} from './severity-visuals.js';

export interface RunAnnotationCountChipProps {
  summary: RunAnnotationSummary | undefined;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt?: number | undefined;
  /** Scopes the destination list to one job. */
  jobId?: string | undefined;
}

/**
 * A bounded reference into the run's Annotations section: a count, its highest severity, and one
 * link. Never a body, so an annotation is rendered exactly once per page.
 */
export function RunAnnotationCountChip({
  summary,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  jobId,
}: RunAnnotationCountChipProps) {
  if (!summary || summary.total === 0) return null;

  const severity = highestRunAnnotationSeverity(summary);
  const count = `${summary.total}${summary.truncated ? '+' : ''}`;
  const label = `${count} ${summary.total === 1 && !summary.truncated ? 'annotation' : 'annotations'}`;
  const accessibleLabel = severity
    ? `View ${label}, highest severity ${severity}`
    : `View ${label}`;
  const search: WorkflowRunsSearch = {tab: 'annotations', ...(runAttempt ? {runAttempt} : {})};
  if (jobId) search.jobId = jobId;

  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{workspaceSlug, projectSlug, workflowRunId}}
      search={workflowRunSearchParams(search, search) as never}
      aria-label={accessibleLabel}
      className={cn(
        'inline-flex h-20 shrink-0 items-center gap-4 rounded-4 border px-6 font-code text-xs leading-16 tabular-nums outline-none transition-colors hover:bg-background-neutral-hover focus-visible:shadow-border-interactive-with-active',
        // The chip stays 20px optically so it sits level with the duration metadata beside it;
        // the hit area grows to the 44px minimum only where the pointer is coarse.
        '[@media(pointer:coarse)]:h-44 [@media(pointer:coarse)]:px-10',
        severity ? SEVERITY_CHIP_TONE[severity] : 'border-border-neutral-base',
      )}
    >
      <Icon
        name={severity ? SEVERITY_ICON[severity] : 'fileTextLine'}
        size={12}
        aria-hidden="true"
      />
      <span className="text-foreground-neutral-base">{count}</span>
    </Link>
  );
}
