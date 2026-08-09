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
import type {EvaluationTraceEntry, Job, JobExecution} from '#core/workflow-run.js';
import {formatJobExecutionTime} from './job-execution-time-text.js';
import {JsonCode} from './json-code.js';
import {EvaluationTrace} from './step-troubleshooting.js';

export function JobContextPanel({job, execution}: {job: Job; execution: JobExecution}) {
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
