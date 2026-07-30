import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@shipfox/react-ui/accordion';
import {Badge, type BadgeVariant} from '@shipfox/react-ui/badge';
import {Dot} from '@shipfox/react-ui/dot';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {TimeTickerProvider, useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn, humanDuration} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {
  isWorkflowStatus,
  type Job,
  type JobDisplayStatus,
  type JobExecution,
  type Step,
  type StepSourceLocation,
} from '#core/workflow-run.js';
import {formatJobExecutionTimeLabel} from '../job-graph/job-duration-format.js';
import {
  buildStepListModel,
  defaultStepListJobExecution,
  humanizeStatus,
  type StepAttemptModel,
  type StepListEntryModel,
  type StepListModel,
} from './step-list-model.js';

export interface StepExpandedContext {
  step: Step;
  stepId: string;
  stepLabel: string;
  sourceLocation: StepSourceLocation | null;
  attempt: number;
  attemptId: string;
  attemptError: Record<string, unknown> | null;
  attemptStatus: string;
  carriedOver: boolean;
}

export interface StepListEmptyState {
  title: string;
  description: string;
  status?: JobDisplayStatus | undefined;
}

export interface StepListProps {
  job: Job;
  jobExecution?: JobExecution | undefined;
  selectedAttemptId?: string | null | undefined;
  defaultSelectedAttemptId?: string | undefined;
  onSelectedAttemptChange?: ((attemptId: string | undefined) => void) | undefined;
  autoSelectActiveAttempt?: boolean | undefined;
  emptyState?: StepListEmptyState | undefined;
  renderExpandedStep?: ((context: StepExpandedContext) => ReactNode) | undefined;
  showHeader?: boolean | undefined;
  className?: string | undefined;
}

export function StepList({
  job,
  jobExecution,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  autoSelectActiveAttempt = false,
  emptyState,
  renderExpandedStep,
  showHeader = true,
  className,
}: StepListProps) {
  const selectedJobExecution = jobExecution ?? defaultStepListJobExecution(job);
  const model = useMemo(
    () => buildStepListModel({job, jobExecution: selectedJobExecution}),
    [job, selectedJobExecution],
  );

  return (
    <StepListContent
      key={model.jobExecutionId}
      model={model}
      selectedAttemptId={selectedAttemptId}
      defaultSelectedAttemptId={defaultSelectedAttemptId}
      onSelectedAttemptChange={onSelectedAttemptChange}
      autoSelectActiveAttempt={autoSelectActiveAttempt}
      emptyState={emptyState}
      renderExpandedStep={renderExpandedStep}
      showHeader={showHeader}
      className={className}
    />
  );
}

function StepListContent({
  model,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  autoSelectActiveAttempt,
  emptyState,
  renderExpandedStep,
  showHeader,
  className,
}: Omit<StepListProps, 'job' | 'jobExecution'> & {model: StepListModel}) {
  const titleId = useId();
  const [localSelectedAttemptIds, setLocalSelectedAttemptIds] = useState<string[]>(() =>
    selectedAttemptId
      ? [selectedAttemptId]
      : defaultSelectedAttemptId
        ? [defaultSelectedAttemptId]
        : [],
  );
  const [userSelectedAttempt, setUserSelectedAttempt] = useState(false);
  const lastNotifiedSelectedAttemptId = useRef<string | null>(null);
  const shouldUseControlledCollapsedState =
    selectedAttemptId === null && lastNotifiedSelectedAttemptId.current === null;
  const autoSelectedAttemptIds =
    selectedAttemptId === undefined &&
    autoSelectActiveAttempt &&
    !userSelectedAttempt &&
    model.activeEntryId
      ? [model.activeEntryId]
      : [];
  const selectedAttemptIds = shouldUseControlledCollapsedState
    ? []
    : localSelectedAttemptIds.length > 0
      ? localSelectedAttemptIds
      : autoSelectedAttemptIds;
  const hasExpandedContent = renderExpandedStep !== undefined;

  useEffect(() => {
    if (selectedAttemptId !== undefined) return;

    setLocalSelectedAttemptIds(defaultSelectedAttemptId ? [defaultSelectedAttemptId] : []);
    setUserSelectedAttempt(false);
  }, [defaultSelectedAttemptId, selectedAttemptId]);

  useEffect(() => {
    if (selectedAttemptId === undefined) return;

    const nextSelectedAttemptId = selectedAttemptId ?? null;
    if (lastNotifiedSelectedAttemptId.current === nextSelectedAttemptId) {
      lastNotifiedSelectedAttemptId.current = null;
      return;
    }

    setLocalSelectedAttemptIds(selectedAttemptId ? [selectedAttemptId] : []);
    setUserSelectedAttempt(true);
  }, [selectedAttemptId]);

  function selectAttempt(nextAttemptIds: string[]) {
    const nextAttemptId = nextSelectedAttemptId(selectedAttemptIds, nextAttemptIds);
    setUserSelectedAttempt(true);
    setLocalSelectedAttemptIds(nextAttemptIds);
    lastNotifiedSelectedAttemptId.current = nextAttemptId ?? null;
    onSelectedAttemptChange?.(nextAttemptId);
  }

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <section
        aria-labelledby={showHeader ? titleId : undefined}
        className={cn(
          'flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-components-base',
          className,
        )}
      >
        {showHeader ? (
          <div className="flex min-h-40 items-center border-b border-border-neutral-base px-16 py-8">
            <Text as="h2" id={titleId} size="sm" bold className="text-foreground-neutral-base">
              {model.jobName}
            </Text>
          </div>
        ) : null}

        {model.entries.length === 0 ? (
          <StepListEmptyStateView emptyState={emptyState} />
        ) : (
          <Accordion
            type="multiple"
            value={selectedAttemptIds}
            onValueChange={selectAttempt}
            asChild
          >
            <ol>
              {model.entries.map((entry) => {
                const selected = selectedAttemptIds.includes(entry.id);
                return (
                  <StepRow
                    key={entry.id}
                    entry={entry}
                    selected={selected}
                    hasExpandedContent={hasExpandedContent}
                    onSelect={() => {
                      selectAttempt(
                        hasExpandedContent
                          ? toggleAttemptId(selectedAttemptIds, entry.id)
                          : selected
                            ? []
                            : [entry.id],
                      );
                    }}
                    expandedContent={
                      selected
                        ? renderExpandedStep?.({
                            step: entry.step,
                            stepId: entry.step.id,
                            stepLabel: entry.step.label,
                            sourceLocation: entry.step.sourceLocation,
                            attempt: entry.attempt,
                            attemptId: entry.id,
                            attemptError: entry.error,
                            attemptStatus: entry.statusVisual.kind,
                            carriedOver: entry.carriedOver,
                          })
                        : null
                    }
                  />
                );
              })}
            </ol>
          </Accordion>
        )}
      </section>
    </TimeTickerProvider>
  );
}

function StepListEmptyStateView({
  emptyState = {
    title: 'No steps recorded',
    description: 'This job has not recorded any steps.',
  },
}: {
  emptyState?: StepListEmptyState | undefined;
}) {
  if (!emptyState.status) {
    return (
      <EmptyState
        className="min-h-120 px-16 py-20"
        icon="componentLine"
        title={emptyState.title}
        description={emptyState.description}
        variant="compact"
      />
    );
  }

  return (
    <div className="flex min-h-120 flex-col items-center justify-center gap-10 px-16 py-20">
      <StepListEmptyStateIcon status={emptyState.status} />
      <div className="text-center">
        <Text size="sm" className="text-foreground-neutral-subtle">
          {emptyState.title}
        </Text>
        <Text size="xs" className="text-foreground-neutral-muted">
          {emptyState.description}
        </Text>
      </div>
    </div>
  );
}

function StepListEmptyStateIcon({status}: {status: JobDisplayStatus}) {
  if (status !== 'running') {
    return (
      <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-8">
        <WorkflowStatusIcon status={status} size={20} tooltip={false} />
      </div>
    );
  }

  return (
    <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-8 text-foreground-neutral-muted">
      <Icon name="timerLine" size={18} aria-hidden="true" />
    </div>
  );
}

function StepRow({
  entry,
  selected,
  hasExpandedContent,
  onSelect,
  expandedContent,
}: {
  entry: StepListEntryModel;
  selected: boolean;
  hasExpandedContent: boolean;
  onSelect: () => void;
  expandedContent: ReactNode;
}) {
  const shouldShowLabelTooltip = entry.step.label.length > 32;
  const rowContent = (
    <>
      <Icon
        name="chevronRight"
        aria-hidden="true"
        className={cn(
          'size-14 shrink-0 text-foreground-neutral-muted transition-transform',
          selected && 'rotate-90',
        )}
      />
      <StepStatusIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-8">
          <Text size="sm" bold className="truncate text-foreground-neutral-base">
            {entry.step.label}
          </Text>
          {entry.step.attempts.length > 1 ? <StepAttemptChip attempt={entry} /> : null}
          {entry.carriedOver ? <CarriedOverBadge /> : null}
        </div>
      </div>
      <StepAttemptDurationLabel attempt={entry} />
    </>
  );
  const rowClasses = cn(
    'group grid min-h-44 w-full grid-cols-[14px_14px_minmax(0,1fr)_auto] items-center gap-x-8 px-12 py-6 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
    selected && 'bg-background-components-hover',
    entry.carriedOver && 'opacity-[0.55]',
  );
  const button = hasExpandedContent ? (
    <AccordionTrigger
      showIcon={false}
      aria-label={entryAccessibleLabel(entry)}
      className={rowClasses}
    >
      {rowContent}
    </AccordionTrigger>
  ) : (
    <button
      type="button"
      aria-expanded={false}
      aria-label={entryAccessibleLabel(entry)}
      onClick={onSelect}
      className={rowClasses}
    >
      {rowContent}
    </button>
  );
  const triggerNode = shouldShowLabelTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        <span className="block max-w-320 break-words">{entry.step.label}</span>
      </TooltipContent>
    </Tooltip>
  ) : (
    button
  );
  const row = (
    <>
      {triggerNode}
      {selected && expandedContent ? (
        <AccordionContent className="border-t border-border-neutral-base bg-background-neutral-base px-12 py-12">
          <div className="grid grid-cols-[14px_14px_minmax(0,1fr)_auto] gap-x-8">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <div className="min-w-0">{expandedContent}</div>
            <span aria-hidden="true" />
          </div>
        </AccordionContent>
      ) : null}
    </>
  );

  if (hasExpandedContent) {
    return (
      <AccordionItem value={entry.id} asChild>
        <li>{row}</li>
      </AccordionItem>
    );
  }

  return <li className="border-b border-border-neutral-base last:border-b-0">{row}</li>;
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
        Carried over from a previous attempt; did not run in this attempt.
      </TooltipContent>
    </Tooltip>
  );
}

function toggleAttemptId(selectedAttemptIds: readonly string[], attemptId: string): string[] {
  if (selectedAttemptIds.includes(attemptId)) {
    return selectedAttemptIds.filter((selectedAttemptId) => selectedAttemptId !== attemptId);
  }
  return [...selectedAttemptIds, attemptId];
}

function nextSelectedAttemptId(
  selectedAttemptIds: readonly string[],
  nextAttemptIds: readonly string[],
): string | undefined {
  if (nextAttemptIds.length === 0) return undefined;

  const openedAttemptId = nextAttemptIds.find(
    (attemptId) => !selectedAttemptIds.includes(attemptId),
  );
  return openedAttemptId ?? nextAttemptIds.at(-1);
}

function StepStatusIcon({entry}: {entry: StepListEntryModel}) {
  if (isWorkflowStatus(entry.statusVisual.kind)) {
    return (
      <WorkflowStatusIcon
        status={entry.statusVisual.kind}
        ripple={entry.statusVisual.ripple}
        size={14}
      />
    );
  }

  return (
    <span role="img" aria-label={entry.statusVisual.label} className="inline-flex shrink-0">
      <Dot
        variant={entry.statusVisual.dot}
        ripple={entry.statusVisual.ripple}
        className="size-12 shrink-0"
      />
    </span>
  );
}

const attemptChipClasses: Record<NonNullable<BadgeVariant>, string> = {
  neutral: 'bg-tag-neutral-bg border-tag-neutral-border',
  info: 'bg-tag-blue-bg border-tag-blue-border',
  feature: 'bg-tag-purple-bg border-tag-purple-border',
  success: 'bg-tag-success-bg border-tag-success-border',
  warning: 'bg-tag-warning-bg border-tag-warning-border',
  error: 'bg-tag-error-bg border-tag-error-border',
};

function StepAttemptChip({attempt}: {attempt: StepAttemptModel}) {
  return (
    <div className="flex shrink-0 items-center gap-4" aria-hidden="true">
      <span
        className={cn(
          'inline-flex h-18 min-w-24 items-center justify-center rounded-4 border px-5 font-code text-xs leading-16 text-foreground-neutral-base',
          attemptChipClasses[attempt.statusVisual.badge ?? 'neutral'],
        )}
      >
        #{attempt.attempt}
      </span>
    </div>
  );
}

function entryAccessibleLabel(entry: StepListEntryModel): string {
  const parts = [entry.step.label, entry.statusVisual.label, `attempt ${entry.attempt}`];
  if (entry.step.error?.category) parts.push(humanizeStatus(entry.step.error.category));
  return parts.join(', ');
}

function StepAttemptDurationLabel({attempt}: {attempt: StepAttemptModel}) {
  const duration = attempt.displayDuration;
  if (duration === null) return null;

  if (duration.state === 'live') {
    return <LiveDurationText fromIso={duration.fromIso} />;
  }

  return <DurationText>{formatJobExecutionTimeLabel(duration)}</DurationText>;
}

function LiveDurationText({fromIso}: {fromIso: string}) {
  useTimeTick();
  return <DurationText>{humanDuration(fromIso)}</DurationText>;
}

function DurationText({children}: {children: string}) {
  return (
    <Code as="span" variant="label" className="shrink-0 tabular-nums text-foreground-neutral-muted">
      {children}
    </Code>
  );
}
