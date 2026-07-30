import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {useIsTextTruncated} from '@shipfox/react-ui/hooks';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Header, Text} from '@shipfox/react-ui/typography';
import type {Ref} from 'react';
import {useId} from 'react';
import {
  isWorkflowRunTerminal,
  type Job,
  WORKFLOW_RUN_STATUSES,
  type WorkflowRunDetail,
  type WorkflowRunRerunMode,
} from '#core/workflow-run.js';
import {WorkflowRunDurationLabel} from '../workflow-run-duration-label.js';
import {getWorkflowStatusVisual} from '../workflow-status/status-visuals.js';
import {WorkflowRunAttemptSwitcher} from './workflow-run-attempt-switcher.js';

const STATUS_BADGE_LABEL_WIDTH_CH = Math.max(
  ...WORKFLOW_RUN_STATUSES.map((status) => getWorkflowStatusVisual(status).label.length),
);

type WorkflowRunAction = 'cancel' | 'rerun-all' | 'rerun-menu' | 'none';

export interface WorkflowRunSummaryProps {
  workspaceId?: string | undefined;
  projectId?: string | undefined;
  run: WorkflowRunDetail;
  sourceAvailable?: boolean | undefined;
  sourceOpen?: boolean | undefined;
  sourcePanelId?: string | undefined;
  sourceButtonRef?: Ref<HTMLButtonElement> | undefined;
  onSourceToggle?: (() => void) | undefined;
  cancelling?: boolean | undefined;
  onCancel?: (() => void) | undefined;
  rerunPending?: boolean | undefined;
  onRerun?: ((mode: WorkflowRunRerunMode) => void) | undefined;
  latestAttempt?: number | undefined;
}

export function WorkflowRunSummary({
  workspaceId,
  projectId,
  run,
  sourceAvailable = false,
  sourceOpen = false,
  sourcePanelId,
  sourceButtonRef,
  onSourceToggle,
  cancelling = false,
  onCancel,
  rerunPending = false,
  onRerun,
  latestAttempt,
}: WorkflowRunSummaryProps) {
  const headingId = useId();
  const status = getWorkflowStatusVisual(run.runAttempt.status);
  const action = workflowRunActionForRun(run);
  const attemptSwitcher =
    latestAttempt && latestAttempt > 1 && workspaceId && projectId
      ? {workspaceId, projectId, latestAttempt}
      : null;
  const displayDuration = run.runAttempt.displayDuration;
  const {ref: headingTextRef, isTruncated: isHeadingTruncated} =
    useIsTextTruncated<HTMLSpanElement>(run.name);

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <section
        aria-labelledby={headingId}
        className="border-b border-border-neutral-base bg-background-subtle-base px-16 py-8"
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12 gap-y-4 overflow-hidden">
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-8">
            <Badge variant={status.badge} size="xs">
              <span className="text-center" style={{width: `${STATUS_BADGE_LABEL_WIDTH_CH}ch`}}>
                {status.label}
              </span>
            </Badge>

            <Tooltip>
              <TooltipTrigger asChild>
                <Header id={headingId} variant="h3" className="min-w-0 truncate">
                  <span
                    ref={headingTextRef}
                    title={isHeadingTruncated ? run.name : undefined}
                    className="block min-w-0 truncate"
                  >
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

          <div className="col-start-2 row-start-1 flex min-w-max items-center gap-6 justify-self-end">
            <WorkflowRunActionSlot
              action={action}
              cancelling={cancelling}
              onCancel={onCancel}
              rerunPending={rerunPending}
              onRerun={onRerun}
            />
            {sourceAvailable ? (
              <Button
                ref={sourceButtonRef}
                type="button"
                variant="secondary"
                size="xs"
                aria-controls={sourcePanelId}
                aria-expanded={sourceOpen}
                onClick={onSourceToggle}
              >
                View source
              </Button>
            ) : null}
          </div>

          <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-12 overflow-hidden text-foreground-neutral-muted">
            {attemptSwitcher ? (
              <WorkflowRunAttemptSwitcher
                workspaceId={attemptSwitcher.workspaceId}
                projectId={attemptSwitcher.projectId}
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
                        className="inline-flex max-w-full min-w-0 items-center gap-4 rounded-6 border-0 bg-transparent p-0 text-left text-foreground-neutral-muted outline-none focus-visible:shadow-button-neutral-focus"
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

            {attemptSwitcher || run.triggerDisplayLabel ? <MetadataSeparator /> : null}
            <RelativeTime
              value={run.runAttempt.createdAt}
              className="shrink-0 whitespace-nowrap text-xs leading-20 text-foreground-neutral-muted"
            />

            {displayDuration ? (
              <>
                <MetadataSeparator />
                <WorkflowRunDurationLabel
                  duration={displayDuration}
                  className="text-foreground-neutral-muted"
                />
              </>
            ) : null}
          </div>
        </div>
      </section>
    </TimeTickerProvider>
  );
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

function workflowRunActionForRun(run: WorkflowRunDetail): WorkflowRunAction {
  if (run.runAttempt.attempt !== run.currentAttempt) return 'none';
  if (!isWorkflowRunTerminal(run.runAttempt.status)) return 'cancel';
  if (run.runAttempt.status === 'succeeded' || !hasFailedOrCancelledJobs(run)) return 'rerun-all';
  return 'rerun-menu';
}

function hasFailedOrCancelledJobs(run: WorkflowRunDetail): boolean {
  if (!workflowRunHasJobs(run)) return false;

  return run.jobs.some((job) => job.status === 'failed' || job.status === 'cancelled');
}

function workflowRunHasJobs(run: WorkflowRunDetail): run is WorkflowRunDetail & {jobs: Job[]} {
  return 'jobs' in run && Array.isArray(run.jobs);
}

function MetadataSeparator() {
  return <span aria-hidden="true" className="h-12 w-px shrink-0 bg-border-neutral-base" />;
}
