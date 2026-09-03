import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shipfox/react-ui/sheet';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import {
  type EvaluationTraceEntry,
  isTerminalJobExecutionStatus,
  type Job,
  type JobExecution,
  type WorkflowDiagnosticUnavailableField,
  type WorkflowJobExecutionContext,
  type WorkflowJobExecutionDetail,
} from '#core/workflow-run.js';
import {useWorkflowJobExecutionContextQuery} from '#hooks/api/workflow-job-detail.js';
import {
  DiagnosticUnavailableAnnouncement,
  DiagnosticUnavailableField,
} from './diagnostic-unavailable.js';
import {formatJobExecutionTime} from './job-execution-time-text.js';
import {JsonCode} from './json-code.js';
import {EvaluationTrace} from './step-troubleshooting.js';

export function JobContextPanel({
  job,
  execution,
  selectedExecution,
}: {
  job: Job;
  execution: JobExecution;
  selectedExecution?: WorkflowJobExecutionDetail | undefined;
}) {
  if (selectedExecution !== undefined) {
    if (!selectedExecution.hasContext && !hasJobExecutionSummaryContext(execution)) return null;
    return (
      <LazyJobContextSheet job={job} execution={execution} selectedExecution={selectedExecution} />
    );
  }

  const runner = execution.runner?.length ? execution.runner : job.runner;
  const outputs = execution.outputs ?? job.outputs;
  const trace = [...(job.evaluationTrace ?? []), ...(execution.evaluationTrace ?? [])];
  const statusReason = execution.statusReason ?? job.statusReason;
  const hasTiming = Boolean(execution.queueTime || execution.runTime);
  const hasContext = Boolean(
    runner?.length ||
      outputs ||
      execution.triggerEvents.length ||
      job.success ||
      statusReason ||
      execution.statusReasonMessage ||
      trace?.length ||
      hasTiming,
  );

  if (!hasContext) return null;

  return (
    <JobContextSheet
      job={job}
      execution={execution}
      runner={runner}
      outputs={outputs}
      trace={trace}
      statusReason={statusReason}
    />
  );
}

function LazyJobContextSheet({
  job,
  execution,
  selectedExecution,
}: {
  job: Job;
  execution: JobExecution;
  selectedExecution: WorkflowJobExecutionDetail;
}) {
  const [open, setOpen] = useState(false);
  const contextQuery = useWorkflowJobExecutionContextQuery({
    jobId: selectedExecution.jobId,
    executionId: selectedExecution.id,
    enabled: open,
    polling: open && !isTerminalJobExecutionStatus(selectedExecution.status),
  });
  const context = contextQuery.data;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Inspect job details"
            onClick={() => setOpen(true)}
            className="flex size-28 shrink-0 items-center justify-center rounded-4 bg-transparent text-foreground-neutral-muted outline-none transition-colors hover:bg-transparent hover:text-foreground-neutral-base active:bg-transparent focus-visible:shadow-button-neutral-focus"
          >
            <Icon name="informationLine" size={14} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Inspect job details</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-full sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{job.displayName}</SheetTitle>
          <SheetDescription>
            Execution #{execution.sequence} · {execution.displayName}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-section">
          {contextQuery.isPending ? <JobContextLoading /> : null}
          {contextQuery.isError && context === undefined ? (
            <JobContextError query={contextQuery} />
          ) : null}
          {contextQuery.isError && context !== undefined ? (
            <JobContextStaleError query={contextQuery} />
          ) : null}
          {context ? <LazyJobContextContent context={context} execution={execution} /> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function LazyJobContextContent({
  context,
  execution,
}: {
  context: WorkflowJobExecutionContext;
  execution: JobExecution;
}) {
  const trace = [
    ...(context.jobEvaluationTrace ?? []),
    ...(context.executionEvaluationTrace ?? []),
  ];
  const {conditionTrace, executionNameTrace} = splitJobEvaluationTrace(trace);

  return (
    <div className="grid w-full min-w-0 gap-group min-[640px]:grid-cols-2">
      <ContextRunner label="Job runner" runner={context.jobRunner} />
      <ContextRunner label="Execution runner" runner={context.executionRunner} />
      <ContextTiming execution={execution} />
      <ContextOutputs context={context} />
      <ContextStatus context={context} execution={execution} />
      <ContextTraceAndEvents
        context={context}
        conditionTrace={conditionTrace}
        executionNameTrace={executionNameTrace}
      />
      <ContextUnavailableFields fields={context.oversizedFields} />
      {!hasLazyJobContextValues(context, execution, trace) ? (
        <Text size="xs" className="text-foreground-neutral-muted">
          No additional execution context was recorded.
        </Text>
      ) : null}
    </div>
  );
}

function ContextRunner({label, runner}: {label: string; runner: string[] | null}) {
  if (!runner?.length) return null;
  return <ContextList label={label} values={runner} mono />;
}

function ContextTiming({execution}: {execution: JobExecution}) {
  if (!execution.queueTime && !execution.runTime) return null;
  return (
    <div className="flex min-w-0 flex-col gap-tight">
      <Text size="xs" bold className="text-foreground-neutral-base">
        Timing
      </Text>
      <div className="flex flex-wrap gap-inline text-xs text-foreground-neutral-muted">
        {execution.queueTime ? (
          <span>Queue {formatJobExecutionTime(execution.queueTime)}</span>
        ) : null}
        {execution.runTime ? <span>Run {formatJobExecutionTime(execution.runTime)}</span> : null}
      </div>
    </div>
  );
}

function ContextOutputs({context}: {context: WorkflowJobExecutionContext}) {
  return (
    <>
      {context.jobOutputs ? (
        <JsonCode
          title="Job outputs"
          value={context.jobOutputs}
          emptyMessage="No job outputs were recorded."
        />
      ) : null}
      {context.executionOutputs ? (
        <JsonCode
          title="Execution outputs"
          value={context.executionOutputs}
          emptyMessage="No execution outputs were recorded."
        />
      ) : null}
    </>
  );
}

function ContextStatus({
  context,
  execution,
}: {
  context: WorkflowJobExecutionContext;
  execution: JobExecution;
}) {
  return (
    <>
      {context.condition ? <ContextValue label="Condition" value={context.condition} mono /> : null}
      {execution.statusReason ? (
        <ContextValue label="Status reason" value={humanize(execution.statusReason)} />
      ) : null}
      {execution.statusReasonMessage ? (
        <ContextValue label="Failure details" value={execution.statusReasonMessage} />
      ) : null}
    </>
  );
}

function ContextTraceAndEvents({
  context,
  conditionTrace,
  executionNameTrace,
}: {
  context: WorkflowJobExecutionContext;
  conditionTrace: EvaluationTraceEntry[];
  executionNameTrace: EvaluationTraceEntry[];
}) {
  return (
    <>
      {context.triggerEvents.length ? (
        <JsonCode
          title={`Trigger events (${context.triggerEvents.length})`}
          value={context.triggerEvents}
        />
      ) : null}
      {executionNameTrace.length ? (
        <EvaluationTraceSection
          title={`Execution name evaluation (${executionNameTrace.length})`}
          trace={executionNameTrace}
        />
      ) : null}
      {conditionTrace.length ? (
        <EvaluationTraceSection
          title={`Condition evaluation (${conditionTrace.length})`}
          trace={conditionTrace}
        />
      ) : null}
    </>
  );
}

function ContextUnavailableFields({
  fields,
}: {
  fields: readonly WorkflowDiagnosticUnavailableField[];
}) {
  if (fields.length === 0) return null;

  return (
    <>
      {fields.map((field) => (
        <DiagnosticUnavailableField
          key={field.field}
          field={field.field}
          storedBytes={field.storedBytes}
        />
      ))}
      <DiagnosticUnavailableAnnouncement count={fields.length} />
    </>
  );
}

function hasLazyJobContextValues(
  context: WorkflowJobExecutionContext,
  execution: JobExecution,
  trace: readonly EvaluationTraceEntry[],
): boolean {
  return Boolean(
    context.jobRunner?.length ||
      context.executionRunner?.length ||
      context.jobOutputs ||
      context.executionOutputs ||
      context.condition ||
      context.triggerEvents.length ||
      trace.length ||
      context.oversizedFields.length ||
      execution.queueTime ||
      execution.runTime ||
      execution.statusReason ||
      execution.statusReasonMessage,
  );
}

function hasJobExecutionSummaryContext(execution: JobExecution): boolean {
  return Boolean(
    execution.queueTime ||
      execution.runTime ||
      execution.statusReason ||
      execution.statusReasonMessage,
  );
}

function JobContextLoading() {
  return (
    <div role="status">
      <Text size="xs" className="text-foreground-neutral-muted">
        Loading execution context…
      </Text>
    </div>
  );
}

function JobContextError({query}: {query: ReturnType<typeof useWorkflowJobExecutionContextQuery>}) {
  return (
    <Callout role="alert" type="warning" variant="secondary">
      <CalloutContent>
        <CalloutTitle>Job context unavailable</CalloutTitle>
        <CalloutDescription className="flex items-center justify-between gap-inline">
          <span>We could not load the context for this execution.</span>
          <Button
            type="button"
            size="2xs"
            variant="secondary"
            isLoading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}

function JobContextStaleError({
  query,
}: {
  query: ReturnType<typeof useWorkflowJobExecutionContextQuery>;
}) {
  return (
    <Callout role="status" aria-live="polite" type="warning" variant="secondary">
      <CalloutContent className="flex items-center justify-between gap-inline">
        <Text size="xs">Could not refresh job context.</Text>
        <Button
          type="button"
          size="2xs"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </CalloutContent>
    </Callout>
  );
}

function JobContextSheet({
  job,
  execution,
  runner,
  outputs,
  trace,
  statusReason,
}: {
  job: Job;
  execution: JobExecution;
  runner: string[] | null;
  outputs: Record<string, unknown> | null;
  trace: EvaluationTraceEntry[];
  statusReason: JobExecution['statusReason'];
}) {
  const [open, setOpen] = useState(false);
  const {conditionTrace, executionNameTrace} = splitJobEvaluationTrace(trace);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Inspect job details"
            onClick={() => setOpen(true)}
            className="flex size-28 shrink-0 items-center justify-center rounded-4 bg-transparent text-foreground-neutral-muted outline-none transition-colors hover:bg-transparent hover:text-foreground-neutral-base active:bg-transparent focus-visible:shadow-button-neutral-focus"
          >
            <Icon name="informationLine" size={14} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Inspect job details</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-full sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{job.displayName}</SheetTitle>
          <SheetDescription>
            Execution #{execution.sequence} · {execution.displayName}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-section">
          <div className="grid w-full min-w-0 gap-group min-[640px]:grid-cols-2">
            {runner?.length ? <ContextList label="Runner" values={runner} mono /> : null}
            {execution.queueTime || execution.runTime ? (
              <div className="flex min-w-0 flex-col gap-tight">
                <Text size="xs" bold className="text-foreground-neutral-base">
                  Timing
                </Text>
                <div className="flex flex-wrap gap-inline text-xs text-foreground-neutral-muted">
                  {execution.queueTime ? (
                    <span>Queue {formatJobExecutionTime(execution.queueTime)}</span>
                  ) : null}
                  {execution.runTime ? (
                    <span>Run {formatJobExecutionTime(execution.runTime)}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {outputs ? (
              <JsonCode
                title="Outputs"
                value={outputs}
                emptyMessage="No outputs declared; the `outputs:` mapping is empty."
              />
            ) : null}
            {job.success ? <ContextValue label="Condition" value={job.success} mono /> : null}
            {statusReason ? (
              <ContextValue label="Status reason" value={humanize(statusReason)} />
            ) : null}
            {execution.statusReasonMessage ? (
              <ContextValue label="Failure details" value={execution.statusReasonMessage} />
            ) : null}
            {execution.triggerEvents.length ? (
              <JsonCode
                title={`Trigger events (${execution.triggerEvents.length})`}
                value={execution.triggerEvents}
              />
            ) : null}
            {executionNameTrace.length ? (
              <EvaluationTraceSection
                title={`Execution name evaluation (${executionNameTrace.length})`}
                trace={executionNameTrace}
              />
            ) : null}
            {conditionTrace.length ? (
              <EvaluationTraceSection
                title={`Condition evaluation (${conditionTrace.length})`}
                trace={conditionTrace}
              />
            ) : null}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function EvaluationTraceSection({
  title,
  trace,
}: {
  title: string;
  trace: readonly EvaluationTraceEntry[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-tight">
      <Text size="xs" bold className="text-foreground-neutral-base">
        {title}
      </Text>
      <EvaluationTrace trace={trace} />
    </div>
  );
}

function ContextValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-tight">
      <Text size="xs" bold className="text-foreground-neutral-base">
        {label}
      </Text>
      <Text
        size="xs"
        className={
          mono
            ? 'break-words font-code text-foreground-neutral-muted'
            : 'text-foreground-neutral-muted'
        }
      >
        {value}
      </Text>
    </div>
  );
}

function ContextList({
  label,
  values,
  mono = false,
}: {
  label: string;
  values: string[];
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-tight">
      <Text size="xs" bold className="text-foreground-neutral-base">
        {label}
      </Text>
      <div className="flex min-w-0 flex-wrap gap-tight">
        {values.map((value) => (
          <Code
            key={value}
            as="span"
            variant="label"
            className={mono ? 'text-foreground-neutral-muted' : 'text-foreground-neutral-base'}
          >
            {value}
          </Code>
        ))}
      </div>
    </div>
  );
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function splitJobEvaluationTrace(trace: readonly EvaluationTraceEntry[]): {
  conditionTrace: EvaluationTraceEntry[];
  executionNameTrace: EvaluationTraceEntry[];
} {
  const conditionTrace: EvaluationTraceEntry[] = [];
  const executionNameTrace: EvaluationTraceEntry[] = [];

  for (const entry of trace) {
    if (!('dropped' in entry) && entry.field === 'job.execution_name') {
      executionNameTrace.push(entry);
    } else {
      conditionTrace.push(entry);
    }
  }

  return {conditionTrace, executionNameTrace};
}
