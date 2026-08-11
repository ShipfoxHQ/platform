import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {Panel} from '@shipfox/react-ui/panel';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {
  useWorkflowRunDurationAccessibleLabel,
  WorkflowRunDurationLabel,
} from '#components/workflow-run-duration-label.js';
import {
  formatWorkflowRunNumberLabel,
  WorkflowRunNumberLabel,
} from '#components/workflow-run-number-label.js';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {
  type WorkflowRunListItem,
  workflowRunActor,
  workflowRunBranchLabel,
  workflowRunCommitLabel,
} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {JOB_STATUS_STRIP_WIDTH, JobStatusStrip, jobStatusSummary} from './job-status-strip.js';

export function WorkflowRunRowList({
  runs,
  workspaceSlug,
  projectSlug,
}: {
  runs: WorkflowRunListItem[];
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  return (
    // A container, not the viewport, drives the row's breakpoints. What a row can afford is its
    // own width; keying off the viewport would keep the job strip hidden on a wide screen or
    // crush it on a narrow one.
    <Panel className="@container">
      <ul className="divide-y divide-border-neutral-base">
        {runs.map((run) => (
          <li key={run.id}>
            <WorkflowRunRow run={run} workspaceSlug={workspaceSlug} projectSlug={projectSlug} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * One run at full width.
 *
 * A single 44px line once the list is at least 976px wide, reflowing to two lines below that:
 * the identity and the numerics keep their places on line one, and the provenance metadata
 * drops beneath. The numeric columns are fixed-width so duration and time form real columns
 * down the list rather than tracking each row's name length.
 *
 * The 976px threshold keeps identity and provenance on one line; below it, provenance drops
 * beneath the identity. The 1200px threshold keeps the full job preview and numeric columns
 * readable together; below it, the strip is hidden so the numeric columns remain aligned.
 */
export function WorkflowRunRow({
  run,
  workspaceSlug,
  projectSlug,
}: {
  run: WorkflowRunListItem;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  const duration = run.runAttempt.displayDuration;
  const hasStarted = run.jobs.hasStartedJobExecution;
  const durationLabel = useWorkflowRunDurationAccessibleLabel(duration, hasStarted);
  const status = run.runAttempt.status;
  const statusLabel = getWorkflowStatusVisual(status).label;
  const runNumberLabel = formatWorkflowRunNumberLabel(run);
  const branch = workflowRunBranchLabel(run);
  const commit = workflowRunCommitLabel(run);
  const actor = workflowRunActor(run);

  const body = (
    <>
      <WorkflowStatusIcon status={status} size={14} className="shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-tight @min-[976px]:flex-row @min-[976px]:items-center @min-[976px]:gap-cluster">
        <span className="flex min-w-0 items-center gap-inline @min-[976px]:flex-1">
          <Code variant="label" bold className="truncate text-foreground-neutral-base">
            {run.name}
          </Code>
          {run.number !== null ? <WorkflowRunNumberLabel run={run} /> : null}
        </span>

        <span className="flex min-w-0 flex-wrap items-center gap-inline text-foreground-neutral-subtle @min-[976px]:flex-nowrap @min-[976px]:shrink-0">
          {run.triggerDisplayLabel ? <TriggerLabel run={run} /> : null}
          {branch ? <BranchLabel branch={branch} isPullRequest={branch.startsWith('#')} /> : null}
          {commit ? <CommitLabel commit={commit} /> : null}
          {actor ? <ActorLabel actor={actor} /> : null}
        </span>
      </div>

      <span className="flex shrink-0 items-center gap-cluster">
        {/* Reserve the API preview's full width so the overflow count cannot paint over the
            duration, and keep it even when a run has no jobs planned yet so the numerics stay in
            line down the list instead of stepping in and out. The max-content width expands if
            the payload ever exceeds the current API preview bound. */}
        <span
          className="hidden w-max shrink-0 @min-[1200px]:flex"
          style={{minWidth: JOB_STATUS_STRIP_WIDTH}}
        >
          <JobStatusStrip jobs={run.jobs} />
        </span>
        <span className="flex w-64 justify-end">
          <WorkflowRunDurationLabel duration={duration} hasStarted={hasStarted} />
        </span>
        <Code
          variant="label"
          className="w-64 shrink-0 text-right tabular-nums text-foreground-neutral-muted"
        >
          <RelativeTime value={run.createdAt} />
        </Code>
      </span>
    </>
  );

  // Rows run edge to edge inside the list's scroll container, which would clip the standard
  // outset focus ring, so this one is inset per the design system's focus-ring rule.
  const rowClassName =
    'flex w-full min-w-0 items-center gap-inline px-row py-row text-left transition-colors hover:bg-background-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary-500)] focus-visible:outline-none @min-[976px]:h-44 @min-[976px]:py-0';

  // Optimistic manual runs (temp-<uuid>) have no detail page until the canonical row
  // replaces them on the next poll, so they render non-interactively instead of as a link
  // that would navigate to a workflow run id the detail route rejects.
  if (run.isTemporary || !workspaceSlug || !projectSlug) {
    return <div className={rowClassName}>{body}</div>;
  }

  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{workspaceSlug, projectSlug, workflowRunId: run.id}}
      search={
        ((previous: Record<string, unknown>) =>
          withoutWorkflowRunSelectionSearch(previous)) as never
      }
      // An aria-label is the link's whole accessible name, so anything inside the row that
      // carries its own label (the status glyph, the job strip) goes unspoken unless it is
      // curated in here. The job breakdown is the reason this list is worth its width, so it
      // belongs in what a tabbing user hears, not only in browse mode.
      aria-label={[
        run.name,
        runNumberLabel,
        statusLabel,
        durationLabel,
        run.triggerLabel,
        branch ? `branch ${branch}` : undefined,
        actor ? `by ${actor}` : undefined,
        run.jobs.total > 0 ? jobStatusSummary(run.jobs) : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join(', ')}
      className={rowClassName}
    >
      {body}
    </Link>
  );
}

function TriggerLabel({run}: {run: WorkflowRunListItem}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-w-0 max-w-[140px] items-center gap-tight outline-none">
          <TriggerSourceIcon
            provider={run.triggerProvider}
            source={run.triggerSource}
            aria-hidden="true"
            className="size-12 shrink-0 text-foreground-neutral-muted"
          />
          <Text as="span" size="xs" className="min-w-0 truncate">
            {run.triggerDisplayLabel}
          </Text>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs" className="block max-w-[360px] break-words">
          {run.triggerLabel}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

function BranchLabel({branch, isPullRequest}: {branch: string; isPullRequest: boolean}) {
  return (
    <MetadataChip
      icon={isPullRequest ? 'gitPullRequestLine' : 'gitBranchLine'}
      title={isPullRequest ? `Pull request ${branch}` : `Branch ${branch}`}
      className="max-w-[180px]"
    >
      {branch}
    </MetadataChip>
  );
}

function CommitLabel({commit}: {commit: string}) {
  return (
    <MetadataChip icon="gitCommitLine" title={`Commit ${commit}`}>
      {commit}
    </MetadataChip>
  );
}

function ActorLabel({actor}: {actor: string}) {
  return (
    <MetadataChip
      icon="userLine"
      title={`Triggered by ${actor}`}
      // Dropped once the row is two lines, where the provenance line has to stay readable on
      // a phone.
      className="hidden max-w-[120px] @min-[976px]:flex"
    >
      {actor}
    </MetadataChip>
  );
}

/**
 * A ref, SHA, or handle: monospace because it is content a user copies or pattern-matches,
 * with the icon carrying the kind so the value itself never needs a written label.
 */
function MetadataChip({
  icon,
  title,
  className,
  children,
}: {
  icon: IconName;
  title: string;
  className?: string | undefined;
  children: string;
}) {
  return (
    <span className={cn('flex min-w-0 shrink-0 items-center gap-tight', className)} title={title}>
      <Icon name={icon} className="size-12 shrink-0 text-foreground-neutral-muted" aria-hidden />
      <Code as="span" variant="label" className="min-w-0 truncate">
        {children}
      </Code>
    </span>
  );
}
