import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {deriveJobDisplayStatus, type JobDisplayStatus} from '#core/entities/job.js';
import type {WorkflowRunJobSummary, WorkflowRunJobs} from '#core/workflow-run.js';

const GLYPH_SIZE = 12;
const MAX_TOOLTIP_JOB_NAMES = 6;

/**
 * Above this the overflow count is abbreviated.
 *
 * Nothing caps a workflow's job count, so an exact count is unbounded in width and would
 * eventually push the strip over its column. Abbreviating keeps the label at most five
 * characters for any magnitude, and the exact figure stays in the tooltip and the strip's
 * accessible name, which is where a precise number is actually read.
 */
const MAX_EXACT_OVERFLOW_COUNT = 999;
const COMPACT_COUNT_FORMAT = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

// Worst-first, so the overflow glyph reports the most alarming thing it is standing in for.
// A strip that hides a failure behind eight green discs would be worse than no strip at all.
const STATUS_SEVERITY: Record<JobDisplayStatus, number> = {
  failed: 5,
  running: 4,
  listening: 4,
  pending: 3,
  cancelled: 2,
  skipped: 1,
  succeeded: 0,
};

const NOTABLE_STATUSES: readonly JobDisplayStatus[] = ['failed', 'running', 'listening'];

export interface JobStatusStripProps {
  jobs: WorkflowRunJobs;
  className?: string | undefined;
}

/**
 * A run's jobs as a row of status glyphs, in graph order.
 *
 * This is the reason the list is worth its width: it answers "where did this run fail"
 * without opening the run. Glyphs are silent to assistive tech and carry no tooltip of their
 * own; the strip speaks once, as a summary, so a 40-job run does not read out 40 labels.
 *
 * What it draws comes from the preview; what it says comes from the counts, which cover every
 * job including those the server never sent. That split is what lets the overflow glyph
 * report a failure sitting past the preview instead of quietly dropping it.
 */
export function JobStatusStrip({jobs, className}: JobStatusStripProps) {
  if (jobs.total === 0) return null;

  // The data frame gives the row enough room for the whole API preview. Only jobs beyond that
  // server-side preview need an overflow marker; the old seven-glyph cap belonged to the
  // previous 1120px page width.
  const visible = jobs.preview;
  const hiddenCount = jobs.total - visible.length;
  const overflowStatus = worstHiddenStatus(jobs, visible);
  const summary = jobStatusSummary(jobs);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={summary}
          className={cn('inline-flex items-center gap-[3px]', className)}
        >
          <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
            {visible.map((job) => (
              <WorkflowStatusIcon
                key={job.id}
                status={displayStatus(job)}
                size={GLYPH_SIZE}
                // One ripple per running job, on every row, would turn a calm list into a
                // field of pulses. The run's own glyph already carries the live edge.
                ripple={false}
                tooltip={false}
              />
            ))}
            {hiddenCount > 0 && overflowStatus ? (
              <span className="inline-flex items-center gap-[2px]">
                <WorkflowStatusIcon
                  status={overflowStatus}
                  size={GLYPH_SIZE}
                  ripple={false}
                  tooltip={false}
                />
                <Code
                  as="span"
                  variant="label"
                  className="tabular-nums text-foreground-neutral-muted"
                >
                  +{overflowCountLabel(hiddenCount)}
                </Code>
              </span>
            ) : null}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <JobStatusStripTooltip jobs={jobs} summary={summary} />
      </TooltipContent>
    </Tooltip>
  );
}

function JobStatusStripTooltip({jobs, summary}: {jobs: WorkflowRunJobs; summary: string}) {
  // Naming the jobs that need attention is the whole point of hovering; succeeded jobs are
  // left to the counts so the tooltip stays a glance rather than a list. Only previewed jobs
  // can be named, but the count of those left over is read off the totals, so a failure past
  // the preview is still accounted for rather than silently missing.
  const named = jobs.preview
    .filter((job) => NOTABLE_STATUSES.includes(displayStatus(job)))
    .slice(0, MAX_TOOLTIP_JOB_NAMES);
  const notableTotal = NOTABLE_STATUSES.reduce((total, status) => total + countOf(jobs, status), 0);
  const remaining = notableTotal - named.length;

  return (
    <span className="flex max-w-[280px] flex-col gap-tight">
      <Text as="span" size="xs" className="block">
        {summary}
      </Text>
      {named.map((job) => (
        <Code as="span" variant="label" key={job.id} className="block truncate">
          {getWorkflowStatusVisual(displayStatus(job)).label.toLowerCase()} · {job.name ?? job.key}
        </Code>
      ))}
      {remaining > 0 ? (
        <Text as="span" size="xs" className="block text-foreground-neutral-muted">
          and {remaining} more
        </Text>
      ) : null}
    </span>
  );
}

/** "12 jobs: 9 succeeded, 2 failed, 1 running" — a count is not an accessible name on its own. */
export function jobStatusSummary(jobs: WorkflowRunJobs): string {
  const breakdown = [...jobs.statusCounts]
    .sort((left, right) => STATUS_SEVERITY[right.status] - STATUS_SEVERITY[left.status])
    .map(({status, count}) => `${count} ${getWorkflowStatusVisual(status).label.toLowerCase()}`)
    .join(', ');

  return `${jobs.total} ${jobs.total === 1 ? 'job' : 'jobs'}: ${breakdown}`;
}

/**
 * The worst status among the jobs the strip is not drawing, found by subtracting what it
 * draws from the run's totals rather than by inspecting jobs it was never sent.
 */
function worstHiddenStatus(
  jobs: WorkflowRunJobs,
  visible: readonly WorkflowRunJobSummary[],
): JobDisplayStatus | null {
  const hidden = new Map(jobs.statusCounts.map(({status, count}) => [status, count]));
  for (const job of visible) {
    const status = displayStatus(job);
    const remaining = (hidden.get(status) ?? 0) - 1;
    if (remaining > 0) hidden.set(status, remaining);
    else hidden.delete(status);
  }

  let worst: JobDisplayStatus | null = null;
  for (const [status, count] of hidden) {
    if (count <= 0) continue;
    if (worst === null || STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}

export function overflowCountLabel(hiddenCount: number): string {
  return hiddenCount <= MAX_EXACT_OVERFLOW_COUNT
    ? String(hiddenCount)
    : COMPACT_COUNT_FORMAT.format(hiddenCount);
}

function countOf(jobs: WorkflowRunJobs, status: JobDisplayStatus): number {
  return jobs.statusCounts.find((entry) => entry.status === status)?.count ?? 0;
}

function displayStatus(job: WorkflowRunJobSummary): JobDisplayStatus {
  return deriveJobDisplayStatus({
    mode: job.mode,
    status: job.status,
    listenerStatus: job.listenerStatus,
    executionStatus: job.executionStatus,
    jobExecutions: [],
  });
}
