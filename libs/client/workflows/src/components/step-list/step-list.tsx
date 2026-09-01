import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
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
  attemptStartedAt: string;
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
  onExpandedAttemptIdsChange?: ((attemptIds: readonly string[]) => void) | undefined;
  inspectorOpenAttemptId?: string | null | undefined;
  onInspectorOpenChange?: ((attemptId: string | null) => void) | undefined;
  autoSelectActiveAttempt?: boolean | undefined;
  emptyState?: StepListEmptyState | undefined;
  renderExpandedStep?: ((context: StepExpandedContext) => ReactNode) | undefined;
  renderInspector?: ((entry: StepListEntryModel) => ReactNode) | undefined;
  showHeader?: boolean | undefined;
  className?: string | undefined;
}

export function StepList({
  job,
  jobExecution,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  onExpandedAttemptIdsChange,
  inspectorOpenAttemptId = null,
  onInspectorOpenChange,
  autoSelectActiveAttempt = false,
  emptyState,
  renderExpandedStep,
  renderInspector,
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
      onExpandedAttemptIdsChange={onExpandedAttemptIdsChange}
      inspectorOpenAttemptId={inspectorOpenAttemptId}
      onInspectorOpenChange={onInspectorOpenChange}
      autoSelectActiveAttempt={autoSelectActiveAttempt}
      emptyState={emptyState}
      renderExpandedStep={renderExpandedStep}
      renderInspector={renderInspector}
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
  onExpandedAttemptIdsChange,
  inspectorOpenAttemptId = null,
  onInspectorOpenChange,
  autoSelectActiveAttempt,
  emptyState,
  renderExpandedStep,
  renderInspector,
  showHeader,
  className,
}: Omit<StepListProps, 'job' | 'jobExecution'> & {model: StepListModel}) {
  const titleId = useId();
  const [localSelectedAttemptIds, setLocalSelectedAttemptIds] = useState<string[]>(() => {
    if (selectedAttemptId) return [selectedAttemptId];
    if (defaultSelectedAttemptId) return [defaultSelectedAttemptId];
    return [];
  });
  const [userSelectedAttempt, setUserSelectedAttempt] = useState(false);
  const lastNotifiedSelectedAttemptId = useRef<string | null>(null);
  const autoSelectedAttemptIdRef = useRef<string | undefined>(undefined);
  const previousSelectedAttemptIdRef = useRef<string | null | undefined>(selectedAttemptId);
  const lastReportedExpandedAttemptIdsKeyRef = useRef<string | null>(null);
  const shouldUseControlledCollapsedState =
    selectedAttemptId === null && lastNotifiedSelectedAttemptId.current === null;
  const autoSelectedAttemptId =
    selectedAttemptId === undefined && autoSelectActiveAttempt && !userSelectedAttempt
      ? (autoSelectedAttemptIdRef.current ?? model.activeEntryId)
      : undefined;
  const autoSelectedAttemptIds = useMemo(
    () => (autoSelectedAttemptId ? [autoSelectedAttemptId] : []),
    [autoSelectedAttemptId],
  );
  const selectedAttemptIds = useMemo(() => {
    if (shouldUseControlledCollapsedState) return [];
    if (localSelectedAttemptIds.length > 0) return localSelectedAttemptIds;
    return autoSelectedAttemptIds;
  }, [autoSelectedAttemptIds, localSelectedAttemptIds, shouldUseControlledCollapsedState]);
  const hasExpandedContent = renderExpandedStep !== undefined;

  useEffect(() => {
    const key = selectedAttemptIds.join('|');
    if (lastReportedExpandedAttemptIdsKeyRef.current === key) return;
    lastReportedExpandedAttemptIdsKeyRef.current = key;
    onExpandedAttemptIdsChange?.(selectedAttemptIds);
  }, [onExpandedAttemptIdsChange, selectedAttemptIds]);

  useEffect(() => {
    if (selectedAttemptId !== undefined) {
      previousSelectedAttemptIdRef.current = selectedAttemptId;
      return;
    }

    // A changing landing candidate is normal while a live job polls. Only reset the local
    // accordion when the parent has just cleared a previously controlled URL selection.
    const wasControlled = previousSelectedAttemptIdRef.current !== undefined;
    previousSelectedAttemptIdRef.current = undefined;
    if (!wasControlled) return;

    setLocalSelectedAttemptIds(defaultSelectedAttemptId ? [defaultSelectedAttemptId] : []);
    setUserSelectedAttempt(false);
    autoSelectedAttemptIdRef.current = undefined;
  }, [defaultSelectedAttemptId, selectedAttemptId]);

  useEffect(() => {
    if (
      selectedAttemptId !== undefined ||
      !autoSelectActiveAttempt ||
      userSelectedAttempt ||
      localSelectedAttemptIds.length > 0 ||
      autoSelectedAttemptIdRef.current !== undefined
    ) {
      return;
    }
    if (model.activeEntryId) autoSelectedAttemptIdRef.current = model.activeEntryId;
  }, [
    autoSelectActiveAttempt,
    localSelectedAttemptIds.length,
    model.activeEntryId,
    selectedAttemptId,
    userSelectedAttempt,
  ]);

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

  useEffect(() => {
    if (
      inspectorOpenAttemptId !== null &&
      !model.entries.some((entry) => entry.id === inspectorOpenAttemptId && !entry.carriedOver)
    ) {
      onInspectorOpenChange?.(null);
    }
  }, [inspectorOpenAttemptId, model.entries, onInspectorOpenChange]);

  function selectAttempt(nextAttemptIds: string[]) {
    const nextAttemptId = nextSelectedAttemptId(selectedAttemptIds, nextAttemptIds);
    setUserSelectedAttempt(true);
    setLocalSelectedAttemptIds(nextAttemptIds);
    lastNotifiedSelectedAttemptId.current = nextAttemptId ?? null;
    onSelectedAttemptChange?.(nextAttemptId);
  }

  const inspectorEntry = model.entries.find(
    (entry) => entry.id === inspectorOpenAttemptId && !entry.carriedOver,
  );

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <section
        aria-labelledby={showHeader ? titleId : undefined}
        className={cn(
          'flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-neutral-base',
          className,
        )}
      >
        {showHeader ? (
          <div className="flex min-h-40 items-center border-b border-border-neutral-base px-row py-row">
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
              {model.entries.map((entry, index) => {
                const selected = selectedAttemptIds.includes(entry.id);
                return (
                  <StepRow
                    key={entry.id}
                    entry={entry}
                    selected={selected}
                    hasExpandedContent={hasExpandedContent}
                    isLast={index === model.entries.length - 1}
                    onSelect={() => {
                      if (hasExpandedContent) {
                        selectAttempt(toggleAttemptId(selectedAttemptIds, entry.id));
                      } else {
                        selectAttempt(selected ? [] : [entry.id]);
                      }
                    }}
                    onInspect={
                      onInspectorOpenChange && !entry.carriedOver
                        ? () => onInspectorOpenChange(entry.id)
                        : undefined
                    }
                    expandedContent={
                      selected
                        ? renderExpandedStep?.({
                            step: entry.step,
                            stepId: entry.step.id,
                            stepLabel: entry.step.label,
                            sourceLocation: entry.step.sourceLocation,
                            attempt: entry.attempt,
                            attemptId: entry.id,
                            attemptStartedAt: entry.startedAt,
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
      {inspectorEntry ? renderInspector?.(inspectorEntry) : null}
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
        icon="componentLine"
        title={emptyState.title}
        description={emptyState.description}
        variant="panel"
      />
    );
  }

  return (
    <div className="flex min-h-120 flex-col items-center justify-center gap-inline p-panel">
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
      <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-tight">
        <WorkflowStatusIcon status={status} size={20} tooltip={false} />
      </div>
    );
  }

  return (
    <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-tight text-foreground-neutral-muted">
      <Icon name="timerLine" size={18} aria-hidden="true" />
    </div>
  );
}

function StepRow({
  entry,
  selected,
  hasExpandedContent,
  isLast,
  onSelect,
  onInspect,
  expandedContent,
}: {
  entry: StepListEntryModel;
  selected: boolean;
  hasExpandedContent: boolean;
  isLast: boolean;
  onSelect: () => void;
  onInspect?: (() => void) | undefined;
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
      <ToolProviderIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-inline">
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
    'group flex min-h-44 min-w-0 flex-1 items-center gap-x-inline bg-transparent px-row py-row text-left transition-colors hover:bg-transparent active:bg-transparent focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
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
      <div
        className={cn(
          'group flex min-w-0 items-center gap-inline bg-background-neutral-base pr-[8px] transition-colors hover:bg-background-neutral-hover active:bg-background-neutral-pressed',
          selected && 'bg-background-neutral-hover',
          !hasExpandedContent && ['border-b border-border-neutral-base', isLast && 'border-b-0'],
        )}
      >
        <div className="min-w-0 flex-1">{triggerNode}</div>
        {onInspect ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Inspect ${entry.step.label}, attempt ${entry.attempt}`}
                onClick={onInspect}
                className="flex size-28 shrink-0 items-center justify-center rounded-4 bg-transparent text-foreground-neutral-muted outline-none transition-colors hover:bg-transparent hover:text-foreground-neutral-base active:bg-transparent focus-visible:shadow-button-neutral-focus"
              >
                <Icon name="informationLine" size={14} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Inspect step details</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {selected && expandedContent ? (
        <AccordionContent className="border-t border-border-neutral-base bg-transparent px-0 py-0">
          <div className="min-w-0">{expandedContent}</div>
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

  return <li>{row}</li>;
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

function ToolProviderIcon({entry}: {entry: StepListEntryModel}) {
  if (entry.step.type !== 'tool') return null;
  const provider = entry.step.toolConfig?.provider;
  const iconName = provider ? PROVIDER_CATALOG[provider]?.iconName : undefined;
  return (
    <Icon
      name={iconName ?? 'componentLine'}
      size={14}
      aria-hidden="true"
      className="shrink-0 text-foreground-neutral-muted"
    />
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
    <div className="flex shrink-0 items-center gap-tight" aria-hidden="true">
      <span
        className={cn(
          'inline-flex h-18 min-w-24 items-center justify-center rounded-4 border px-tight font-code text-xs leading-16 text-foreground-neutral-base',
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
  if (entry.step.toolConfig?.provider) {
    parts.push(`${humanizeStatus(entry.step.toolConfig.provider)} integration`);
  }
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
