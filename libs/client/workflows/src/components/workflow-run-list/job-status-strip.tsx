import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {JobStatus, WorkflowRunJobSummary, WorkflowRunJobs} from '#core/workflow-run.js';

/**
 * How many glyphs fit the strip's column before it starts costing the run name width.
 *
 * Sized so the widest case still fits the row's 160px strip column: seven 12px glyphs with
 * 3px gaps is 102px, and the overflow indicator adds a glyph plus a monospace count, up to
 * about 56px at four digits. Overshooting does not wrap, it paints over the duration column.
 * This sits under the API's preview bound, so resizing the strip is a change in this file.
 */
const MAX_VISIBLE_JOBS = 7;
const GLYPH_SIZE = 12;
const MAX_TOOLTIP_JOB_NAMES = 6;

// Worst-first, so the overflow glyph reports the most alarming thing it is standing in for.
// A strip that hides a failure behind eight green discs would be worse than no strip at all.
const STATUS_SEVERITY: Record<JobStatus, number> = {
  failed: 5,
  running: 4,
  pending: 3,
  cancelled: 2,
  skipped: 1,
  succeeded: 0,
};

const NOTABLE_STATUSES: readonly JobStatus[] = ['failed', 'running'];

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

  const visible = jobs.preview.slice(0, MAX_VISIBLE_JOBS);
  const hiddenCount = jobs.total - visible.length;
  const overflowStatus = worstHiddenStatus(jobs, visible);
  const summary = jobStatusSummary(jobs);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={summary}
          className={cn('inline-flex items-center gap-3', className)}
        >
          <span aria-hidden="true" className="inline-flex items-center gap-3">
            {visible.map((job) => (
              <WorkflowStatusIcon
                key={job.id}
                status={job.status}
                size={GLYPH_SIZE}
                // One ripple per running job, on every row, would turn a calm list into a
                // field of pulses. The run's own glyph already carries the live edge.
                ripple={false}
                tooltip={false}
              />
            ))}
            {hiddenCount > 0 && overflowStatus ? (
              <span className="inline-flex items-center gap-2">
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
                  +{hiddenCount}
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
    .filter((job) => NOTABLE_STATUSES.includes(job.status))
    .slice(0, MAX_TOOLTIP_JOB_NAMES);
  const notableTotal = NOTABLE_STATUSES.reduce((total, status) => total + countOf(jobs, status), 0);
  const remaining = notableTotal - named.length;

  return (
    <span className="block max-w-[280px]">
      <Text as="span" size="xs" className="block">
        {summary}
      </Text>
      {named.map((job) => (
        <Code as="span" variant="label" key={job.id} className="mt-2 block truncate">
          {getWorkflowStatusVisual(job.status).label.toLowerCase()} · {job.name ?? job.key}
        </Code>
      ))}
      {remaining > 0 ? (
        <Text as="span" size="xs" className="mt-2 block text-foreground-neutral-muted">
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
): JobStatus | null {
  const hidden = new Map(jobs.statusCounts.map(({status, count}) => [status, count]));
  for (const job of visible) {
    const remaining = (hidden.get(job.status) ?? 0) - 1;
    if (remaining > 0) hidden.set(job.status, remaining);
    else hidden.delete(job.status);
  }

  let worst: JobStatus | null = null;
  for (const [status, count] of hidden) {
    if (count <= 0) continue;
    if (worst === null || STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}

function countOf(jobs: WorkflowRunJobs, status: JobStatus): number {
  return jobs.statusCounts.find((entry) => entry.status === status)?.count ?? 0;
}
