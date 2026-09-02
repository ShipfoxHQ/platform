import {useAuthState} from '@shipfox/client-shell/runtime';
import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {MetadataSeparator} from '@shipfox/client-ui';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {useIsTextTruncated} from '@shipfox/react-ui/hooks';
import {Icon} from '@shipfox/react-ui/icon';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {Fragment, type ReactElement, useId} from 'react';
import {WorkflowRunNumberLabel} from '#components/workflow-run-number-label.js';
import {
  isWorkflowRunTerminal,
  WORKFLOW_RUN_STATUSES,
  type WorkflowRunDetail,
  type WorkflowRunListItem,
  type WorkflowRunOverview,
  type WorkflowRunRerunMode,
  workflowRunBranchLabel,
  workflowRunCommitLabel,
  workflowRunDevSourceLabel,
  workflowRunInitiatorLabel,
} from '#core/workflow-run.js';
import {WorkflowRunDurationLabel} from '../workflow-run-duration-label.js';
import {getWorkflowStatusVisual} from '../workflow-status/status-visuals.js';
import {WorkflowRunAttemptSwitcher} from './workflow-run-attempt-switcher.js';

const STATUS_BADGE_LABEL_WIDTH_CH = Math.max(
  ...WORKFLOW_RUN_STATUSES.map((status) => getWorkflowStatusVisual(status).label.length),
);
const NEUTRAL_ACTION_SURFACE_CLASS_NAME =
  'bg-background-neutral-base hover:bg-background-neutral-hover active:bg-background-neutral-pressed';

type WorkflowRunAction = 'cancel' | 'rerun-all' | 'rerun-menu' | 'none';

export type WorkflowRunSummaryRun = WorkflowRunDetail | WorkflowRunOverview | WorkflowRunListItem;

export interface WorkflowRunSummaryProps {
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  run: WorkflowRunSummaryRun;
  cancelling?: boolean | undefined;
  onCancel?: (() => void) | undefined;
  rerunPending?: boolean | undefined;
  onRerun?: ((mode: WorkflowRunRerunMode) => void) | undefined;
  latestAttempt?: number | undefined;
}

export function WorkflowRunSummary({
  workspaceSlug,
  projectSlug,
  run,
  cancelling = false,
  onCancel,
  rerunPending = false,
  onRerun,
  latestAttempt,
}: WorkflowRunSummaryProps) {
  const headingId = useId();
  const status = getWorkflowStatusVisual(run.runAttempt.status);
  const action = workflowRunActionForRun(run);
  const hasAction = canRenderWorkflowRunAction(action, onCancel, onRerun);
  const attemptSwitcher = workflowAttemptSwitcher(latestAttempt, workspaceSlug, projectSlug);
  const displayDuration = run.runAttempt.displayDuration;
  const hasStarted = workflowRunHasStartedJobExecution(run);
  const {ref: headingTextRef, isTruncated: isHeadingTruncated} =
    useIsTextTruncated<HTMLSpanElement>(run.name);
  const currentUser = useAuthState().user;
  const branch = workflowRunBranchLabel(run);
  const commit = workflowRunCommitLabel(run);
  const devSourceLabel = workflowRunDevSourceLabel(run);
  const initiator = workflowRunInitiatorLabel(run, currentUser?.id);
  const replayOfEvent = run.devSource?.replayOfEventId;
  const isDevRun = run.origin === 'dev';
  // The provenance segment only earns a leading separator when something already sits on the
  // line; a run with nothing else (no number, no trigger label) must not start with a dot.
  const metadataHasLeading = metadataHasLeadingContent(run, attemptSwitcher);
  const hasProvenance = runHasProvenance({
    isDevRun,
    devSourceLabel,
    initiator,
    replayOfEvent,
    branch,
    commit,
  });

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <section aria-labelledby={headingId} className="px-row py-row">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-cluster gap-y-inline overflow-hidden max-[480px]:grid-cols-1">
          <div className="col-start-1 row-start-1 min-w-0 max-[480px]:col-start-auto max-[480px]:row-start-auto">
            <div className="flex min-w-0 items-center gap-inline">
              <Badge variant={status.badge} size="xs">
                <span className="text-center" style={{width: `${STATUS_BADGE_LABEL_WIDTH_CH}ch`}}>
                  {status.label}
                </span>
              </Badge>

              {isDevRun ? (
                <Badge variant="feature" size="xs">
                  Dev
                </Badge>
              ) : null}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Header as="h1" id={headingId} variant="h3" className="min-w-0 truncate">
                    <span ref={headingTextRef} className="block min-w-0 truncate">
                      {run.name}
                    </span>
                  </Header>
                </TooltipTrigger>
                {isHeadingTruncated ? (
                  <TooltipContent>
                    <Text as="span" size="xs" className="max-w-[360px] break-words">
                      {run.name}
                    </Text>
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </div>
          </div>

          {hasAction ? (
            <div className="col-start-2 row-start-1 flex min-w-max items-center gap-inline justify-self-end max-[480px]:col-start-auto max-[480px]:row-start-auto max-[480px]:justify-self-start">
              <WorkflowRunActionSlot
                action={action}
                cancelling={cancelling}
                onCancel={onCancel}
                rerunPending={rerunPending}
                onRerun={onRerun}
              />
            </div>
          ) : null}

          <div className="col-span-2 row-start-2 flex min-w-0 flex-nowrap items-center gap-cluster overflow-hidden text-foreground-neutral-subtle max-[480px]:col-span-1 max-[480px]:row-start-auto max-[480px]:flex-wrap max-[480px]:overflow-visible">
            {run.number !== null ? (
              <>
                <WorkflowRunNumberLabel run={run} />
                {attemptSwitcher || run.triggerDisplayLabel ? <MetadataSeparator /> : null}
              </>
            ) : null}

            {attemptSwitcher ? (
              <WorkflowRunAttemptSwitcher
                workspaceSlug={attemptSwitcher.workspaceSlug}
                projectSlug={attemptSwitcher.projectSlug}
                run={run}
                latestAttempt={attemptSwitcher.latestAttempt}
              />
            ) : null}

            {run.triggerDisplayLabel ? (
              <>
                {attemptSwitcher ? <MetadataSeparator /> : null}
                <span className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={run.triggerLabel}
                        className="inline-flex max-w-full min-w-0 cursor-help items-center gap-tight rounded-6 border-0 bg-transparent p-0 text-left text-foreground-neutral-subtle outline-none focus-visible:shadow-button-neutral-focus"
                      >
                        <TriggerSourceIcon
                          provider={run.triggerProvider}
                          source={run.triggerSource}
                          aria-hidden="true"
                          className="size-12 shrink-0"
                        />
                        <Text as="span" size="xs" className="min-w-0 truncate">
                          {run.triggerDisplayLabel}
                        </Text>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Text as="span" size="xs" className="block max-w-[360px] break-words">
                        {run.triggerLabel}
                      </Text>
                    </TooltipContent>
                  </Tooltip>
                </span>
              </>
            ) : null}

            {isDevRun ? (
              <RunProvenanceItems
                devSourceLabel={devSourceLabel}
                initiator={initiator}
                replayOfEventId={replayOfEvent}
                replayOfEventLabel={run.triggerDisplayLabel}
                workspaceSlug={workspaceSlug}
                preceded={metadataHasLeading}
              />
            ) : (
              <RunProvenanceItems
                branch={branch}
                commit={commit}
                workspaceSlug={workspaceSlug}
                preceded={metadataHasLeading}
              />
            )}

            {run.number !== null || attemptSwitcher || run.triggerDisplayLabel || hasProvenance ? (
              <MetadataSeparator />
            ) : null}
            <RelativeTime
              value={run.runAttempt.createdAt}
              className="shrink-0 whitespace-nowrap text-xs leading-20 text-foreground-neutral-subtle"
            />

            {displayDuration ? (
              <>
                <MetadataSeparator />
                <WorkflowRunDurationLabel
                  duration={displayDuration}
                  hasStarted={hasStarted}
                  className="text-foreground-neutral-subtle"
                />
              </>
            ) : null}
          </div>
        </div>
      </section>
    </TimeTickerProvider>
  );
}

function workflowAttemptSwitcher(
  latestAttempt: number | undefined,
  workspaceSlug: string | undefined,
  projectSlug: string | undefined,
) {
  if (!latestAttempt || latestAttempt <= 1 || !workspaceSlug || !projectSlug) return null;
  return {workspaceSlug, projectSlug, latestAttempt};
}

function metadataHasLeadingContent(
  run: WorkflowRunSummaryRun,
  attemptSwitcher: ReturnType<typeof workflowAttemptSwitcher>,
): boolean {
  return run.number !== null || attemptSwitcher !== null || Boolean(run.triggerDisplayLabel);
}

function runHasProvenance({
  isDevRun,
  devSourceLabel,
  initiator,
  replayOfEvent,
  branch,
  commit,
}: {
  isDevRun: boolean;
  devSourceLabel: string | null | undefined;
  initiator: string | null | undefined;
  replayOfEvent: string | null | undefined;
  branch: string | null | undefined;
  commit: string | null | undefined;
}): boolean {
  if (isDevRun) return Boolean(devSourceLabel || initiator || replayOfEvent);
  return Boolean(branch || commit);
}

function WorkflowRunActionSlot({
  action,
  cancelling,
  onCancel,
  rerunPending,
  onRerun,
}: {
  action: WorkflowRunAction;
  cancelling: boolean;
  onCancel?: (() => void) | undefined;
  rerunPending: boolean;
  onRerun?: ((mode: WorkflowRunRerunMode) => void) | undefined;
}) {
  if (action === 'none') return null;

  if (action === 'cancel') {
    if (!onCancel) return null;

    return (
      <Button
        type="button"
        variant="danger"
        size="xs"
        isLoading={cancelling}
        disabled={cancelling}
        onClick={onCancel}
      >
        Cancel workflow
      </Button>
    );
  }

  if (action === 'rerun-all') {
    if (!onRerun) return null;

    return (
      <Button
        type="button"
        variant="secondary"
        size="xs"
        className={NEUTRAL_ACTION_SURFACE_CLASS_NAME}
        isLoading={rerunPending}
        disabled={rerunPending}
        onClick={() => onRerun('all')}
      >
        Re-run workflow
      </Button>
    );
  }

  if (!onRerun) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className={NEUTRAL_ACTION_SURFACE_CLASS_NAME}
          iconRight="arrowDownSLine"
          isLoading={rerunPending}
          disabled={rerunPending}
        >
          Re-run jobs
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={rerunPending} onSelect={() => onRerun('all')}>
          Re-run all jobs
        </DropdownMenuItem>
        <DropdownMenuItem disabled={rerunPending} onSelect={() => onRerun('failed')}>
          Re-run failed jobs
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function workflowRunActionForRun(run: WorkflowRunSummaryRun): WorkflowRunAction {
  if (run.runAttempt.attempt !== run.currentAttempt) return 'none';
  if (!isWorkflowRunTerminal(run.runAttempt.status)) return 'cancel';
  if (run.runAttempt.status === 'succeeded' || !hasFailedOrCancelledJobs(run)) return 'rerun-all';
  return 'rerun-menu';
}

function canRenderWorkflowRunAction(
  action: WorkflowRunAction,
  onCancel: (() => void) | undefined,
  onRerun: ((mode: WorkflowRunRerunMode) => void) | undefined,
): boolean {
  if (action === 'cancel') return onCancel !== undefined;
  if (action === 'rerun-all' || action === 'rerun-menu') return onRerun !== undefined;
  return false;
}

/**
 * The provenance run of the summary line: branch and commit for a synced run (from the
 * trigger reference), and for a dev run the effective `ref @ commit`, the member who started
 * it, and the replay link to the source event when the run replays one.
 *
 * Each item is followed by a separator; the line's other segments already do the same, so
 * the whole metadata row reads as one separated list.
 */
function RunProvenanceItems({
  branch,
  commit,
  devSourceLabel,
  initiator,
  replayOfEventId,
  replayOfEventLabel,
  workspaceSlug,
  preceded,
}: {
  branch?: string | null | undefined;
  commit?: string | null | undefined;
  devSourceLabel?: string | null | undefined;
  initiator?: string | null | undefined;
  replayOfEventId?: string | null | undefined;
  replayOfEventLabel?: string | undefined;
  workspaceSlug?: string | undefined;
  preceded: boolean;
}) {
  const items: ReactElement[] = [
    branch ? <BranchLabel key="branch" branch={branch} /> : null,
    commit ? <CommitLabel key="commit" commit={commit} /> : null,
    devSourceLabel ? <DevSourceLabel key="dev-source" label={devSourceLabel} /> : null,
    initiator ? <InitiatorLabel key="initiator" label={initiator} /> : null,
    replayOfEventId ? (
      <ReplayOfEventLabel
        key="replay"
        eventId={replayOfEventId}
        eventLabel={replayOfEventLabel}
        workspaceSlug={workspaceSlug}
      />
    ) : null,
  ].filter((item): item is ReactElement => item !== null);

  if (items.length === 0) return null;

  return (
    <>
      {preceded ? <MetadataSeparator /> : null}
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <MetadataSeparator /> : null}
          {item}
        </Fragment>
      ))}
    </>
  );
}

/** A ref, SHA, or handle: monospace because it is content a user copies or pattern-matches. */
function ProvenanceChip({
  icon,
  title,
  children,
}: {
  icon: 'gitBranchLine' | 'gitCommitLine' | 'userLine';
  title: string;
  children: string;
}) {
  return (
    <span
      role="img"
      aria-label={title}
      className="flex min-w-0 shrink-0 items-center gap-tight"
      title={title}
    >
      <Icon name={icon} className="size-12 shrink-0 text-foreground-neutral-muted" aria-hidden />
      <Code as="span" variant="label" className="min-w-0 truncate">
        {children}
      </Code>
    </span>
  );
}

function BranchLabel({branch}: {branch: string}) {
  return (
    <ProvenanceChip
      icon="gitBranchLine"
      title={branch.startsWith('#') ? `Pull request ${branch}` : `Branch ${branch}`}
    >
      {branch}
    </ProvenanceChip>
  );
}

function CommitLabel({commit}: {commit: string}) {
  return (
    <ProvenanceChip icon="gitCommitLine" title={`Commit ${commit}`}>
      {commit}
    </ProvenanceChip>
  );
}

/**
 * The dev run's provenance in one label: `fix-triage-prompt @ a1b2c3d`. The ref is the
 * branch or tag the definition came from, the commit the ref was pinned to when the run
 * started, so a force-push after submit cannot change what the label promises.
 */
function DevSourceLabel({label}: {label: string}) {
  return (
    <ProvenanceChip icon="gitBranchLine" title={`Dev source ${label}`}>
      {label}
    </ProvenanceChip>
  );
}

function InitiatorLabel({label}: {label: string}) {
  return (
    <ProvenanceChip icon="userLine" title={`Initiated by ${label}`}>
      {label}
    </ProvenanceChip>
  );
}

/**
 * The link back to the journaled event a dev run replays. It needs the workspace slug to
 * navigate; without it (isolated renders) it reads as plain text.
 */
function ReplayOfEventLabel({
  eventId,
  eventLabel,
  workspaceSlug,
}: {
  eventId: string;
  eventLabel?: string | undefined;
  workspaceSlug?: string | undefined;
}) {
  const label = `Replay of ${eventLabel || eventId.slice(0, 8)}`;
  if (!workspaceSlug) {
    return (
      <Text as="span" size="xs" className="text-foreground-neutral-subtle">
        {label}
      </Text>
    );
  }
  return (
    <Link
      to="/w/$workspaceSlug/settings/events"
      params={{workspaceSlug}}
      search={{eventId}}
      className="inline-flex items-center gap-tight text-foreground-neutral-subtle outline-none transition-colors hover:text-foreground-neutral-base focus-visible:shadow-button-neutral-focus"
    >
      <Icon name="historyLine" className="size-12 shrink-0" aria-hidden />
      <Text as="span" size="xs">
        {label}
      </Text>
    </Link>
  );
}

function hasFailedOrCancelledJobs(run: WorkflowRunSummaryRun): boolean {
  if (Array.isArray(run.jobs)) {
    return run.jobs.some((job) => job.status === 'failed' || job.status === 'cancelled');
  }

  if ('preview' in run.jobs) {
    return run.jobs.statusCounts.some(({status}) => status === 'failed' || status === 'cancelled');
  }

  if (run.jobs.kind === 'complete') {
    return run.jobs.items.some((job) => job.status === 'failed' || job.status === 'cancelled');
  }

  return run.jobs.statusCounts.some(({status}) => status === 'failed' || status === 'cancelled');
}

function workflowRunHasStartedJobExecution(run: WorkflowRunSummaryRun): boolean {
  return 'hasStartedJobExecution' in run
    ? run.hasStartedJobExecution
    : run.jobs.hasStartedJobExecution;
}
