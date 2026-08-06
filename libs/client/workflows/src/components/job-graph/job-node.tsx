import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {Badge} from '@shipfox/react-ui/badge';
import {useIsTextTruncated} from '@shipfox/react-ui/hooks';
import {Icon} from '@shipfox/react-ui/icon';
import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import type {KeyboardEventHandler, Ref} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {
  defaultJobExecution,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  type JobExecution,
  type JobExecutionStatus,
  type WorkflowRunDetail,
} from '#core/workflow-run.js';
import type {JobGraphNode} from './graph-model.js';
import {formatJobDurationAccessibleLabel} from './job-duration-format.js';
import {JobDurationLabel} from './job-duration-label.js';

const TRIGGER_SIZE = 36;

export function TriggerNode({
  trigger,
}: {
  trigger: Pick<
    WorkflowRunDetail,
    'triggerDisplayLabel' | 'triggerLabel' | 'triggerProvider' | 'triggerSource'
  >;
}) {
  const label = trigger.triggerDisplayLabel || 'trigger';
  const tooltip = trigger.triggerLabel || label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex cursor-help items-center justify-center rounded-full bg-background-neutral-base shadow-button-neutral transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
          style={{width: TRIGGER_SIZE, height: TRIGGER_SIZE}}
        >
          <TriggerSourceIcon
            provider={trigger.triggerProvider}
            source={trigger.triggerSource}
            aria-hidden
            className="size-14 shrink-0 text-foreground-neutral-subtle"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function JobNode({
  node,
  selected,
  onSelect,
  onKeyDown,
  onHoverStart,
  onHoverEnd,
  ref,
}: {
  node: JobGraphNode;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  useTimeTick();
  const status = deriveJobDisplayStatus(node);
  const execution = defaultJobExecution(node);
  const visual = getWorkflowStatusVisual(status);
  const accessibleLabel = [
    node.displayName,
    visual.label,
    formatJobDurationAccessibleLabel(
      node.displayDuration,
      execution ? deriveJobExecutionDisplayStatus(execution) : undefined,
    ),
    node.executionCountVisible
      ? executionCountAccessibleLabel(node.jobExecutions.length)
      : undefined,
    node.carriedOver ? 'reused' : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      aria-label={accessibleLabel}
      data-job-id={node.id}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      className={cn(
        'group relative flex h-48 w-208 cursor-pointer items-center gap-inline rounded-8 bg-background-neutral-base px-[10px] text-left shadow-button-neutral transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none',
        selected && 'bg-background-components-hover hover:bg-background-components-pressed',
        node.carriedOver && 'opacity-[0.55]',
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-6 left-0 w-px rounded-full bg-border-highlights-interactive"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-inline">
        <WorkflowStatusIcon status={status} size={14} />
        <JobLabel label={node.displayName} />
      </div>
      <JobDurationLabel duration={node.displayDuration} />
      {node.executionCountVisible ? <ExecutionCountText executions={node.jobExecutions} /> : null}
      {node.carriedOver ? <CarriedOverBadge /> : null}
    </button>
  );
}

function ExecutionCountText({executions}: {executions: JobExecution[]}) {
  const count = executions.length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-hidden="true"
          className="inline-flex h-20 min-w-28 shrink-0 items-center justify-end gap-tight text-foreground-neutral-subtle"
        >
          <Icon name="loopRightLine" className="size-12" />
          <Code as="span" variant="label" className="text-current">
            {count}
          </Code>
        </span>
      </TooltipTrigger>
      <TooltipContent>{executionCountTooltip(executions)}</TooltipContent>
    </Tooltip>
  );
}

function CarriedOverBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          <Badge variant="neutral" size="2xs">
            reused
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Carried over from a previous attempt; did not run in this attempt
      </TooltipContent>
    </Tooltip>
  );
}

function JobLabel({label}: {label: string}) {
  const {ref: labelRef, isTruncated} = useIsTextTruncated<HTMLSpanElement>(label);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span ref={labelRef} className="block min-w-0 truncate">
          <Code as="span" variant="label" bold className="text-foreground-neutral-base">
            {label}
          </Code>
        </span>
      </TooltipTrigger>
      {isTruncated ? <TooltipContent>{label}</TooltipContent> : null}
    </Tooltip>
  );
}

function executionCountAccessibleLabel(count: number): string {
  return `${count} ${count === 1 ? 'execution' : 'executions'}`;
}

function executionCountTooltip(executions: JobExecution[]): string {
  const counts = executionStatusCounts(executions);
  const parts = EXECUTION_STATUSES.map((status) =>
    counts[status] > 0 ? `${counts[status]} ${status}` : undefined,
  ).filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(', ') : 'No executions';
}

const EXECUTION_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly JobExecutionStatus[];

function executionStatusCounts(executions: JobExecution[]) {
  return executions.reduce(
    (counts, execution) => {
      counts[deriveJobExecutionDisplayStatus(execution)] += 1;
      return counts;
    },
    {pending: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0},
  );
}
