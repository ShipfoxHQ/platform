import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shipfox/react-ui/sheet';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';
import type {
  EvaluationTraceEntry,
  JobStatusReason,
  Step,
  StepAttempt,
  StepError,
} from '#core/workflow-run.js';
import {useStepAttemptDetailQuery} from '#hooks/api/step-attempt-detail.js';
import {workflowRunSearchParams} from '#routes/inputs.js';
import {humanizeStatus, type StepListEntryModel} from '../step-list/step-list-model.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';
import {toSelectedAttemptError} from './job-empty-states.js';
import {JsonCode, type JsonCodeEntry, JsonCodeTabs} from './json-code.js';

export interface StepInspectorSheetProps {
  entry: StepListEntryModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
  jobId: string;
  annotationCount?: number | undefined;
}

export function StepInspectorSheet({
  entry,
  open,
  onOpenChange,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  jobId,
  annotationCount,
}: StepInspectorSheetProps) {
  const error = selectedStepError(entry.step, entry.error);
  const inspectorQuery = useStepAttemptDetailQuery(entry.step.id, entry.attempt, {
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{entry.step.label}</SheetTitle>
          <SheetDescription>
            Attempt #{entry.attempt} · {humanizeStatus(entry.statusVisual.kind)}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-section">
          <StepInspector
            step={entry.step}
            attempt={entry}
            error={error}
            showFailure={entry.statusVisual.kind === 'failed' || entry.error !== null}
            query={inspectorQuery}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={workflowRunId}
            runAttempt={runAttempt}
            jobId={jobId}
            annotationCount={annotationCount}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function StepFailureCallout({
  step,
  attempt,
  error,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
}: {
  step: Step;
  attempt: StepAttempt;
  error: StepError | null;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
}) {
  const reason = error?.reason ?? step.statusReason ?? 'unknown';
  const title = failureTitle(reason);
  const sourceLink = sourceLinkForFailure(reason) && step.sourceLocation;

  if (step.type === 'agent' && reason === 'agent_config_invalid') {
    return (
      <AgentConfigFailureCallout
        workspaceSlug={workspaceSlug}
        config={step.agentConfig}
        error={error}
      />
    );
  }

  return (
    <Callout
      role="alert"
      type="error"
      variant="secondary"
      className="rounded-8 border border-tag-error-border p-panel-compact shadow-none"
    >
      <CalloutContent>
        <CalloutTitle>{title}</CalloutTitle>
        <CalloutDescription>
          <div className="flex min-w-0 flex-wrap items-center gap-x-inline gap-y-tight">
            <div className="flex min-w-0 flex-col gap-tight">
              <span>{failureDescription(reason)}</span>
              {error?.message ? (
                <span className="text-foreground-neutral-muted">{error.message}</span>
              ) : null}
            </div>
            <Code as="span" variant="label" className="text-tag-error-text">
              {reason}
            </Code>
            {sourceLink ? (
              <Link
                to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
                params={{workspaceSlug, projectSlug, workflowRunId}}
                search={
                  workflowRunSearchParams(
                    {tab: 'source'},
                    {stepId: step.id, stepAttemptId: attempt.id, runAttempt},
                  ) as never
                }
                className="font-medium text-foreground-highlight-interactive underline-offset-2 hover:underline"
              >
                View in source
              </Link>
            ) : null}
          </div>
        </CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}

function StepInspector({
  step,
  attempt,
  error,
  showFailure,
  query,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  jobId,
  annotationCount,
}: {
  step: Step;
  attempt: StepAttempt;
  error: StepError | null;
  showFailure: boolean;
  query: ReturnType<typeof useStepAttemptDetailQuery>;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
  jobId: string;
  annotationCount: number | undefined;
}) {
  const detail = query.data;
  const trace = detail?.evaluationTrace ?? null;
  const resolvedConfig = detail?.config ?? null;
  const hasInputs =
    detail !== undefined &&
    (countConfigValues(detail.authoredConfig) > 0 || countConfigValues(resolvedConfig) > 0);
  const hasOutputs =
    attempt.outputs !== null || attempt.output !== null || attempt.response !== null;
  const hasTrace = trace !== null && trace.length > 0;
  const hasAnnotations = annotationCount !== undefined && annotationCount > 0;
  const detailCount = Number(hasInputs) + Number(hasOutputs) + Number(hasTrace);

  return (
    <div className="flex min-w-0 flex-col gap-section">
      {showFailure ? (
        <StepFailureCallout
          step={step}
          attempt={attempt}
          error={error}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          workflowRunId={workflowRunId}
          runAttempt={runAttempt}
        />
      ) : null}
      {query.isPending ? <InspectorLoading /> : null}
      {query.isError ? (
        <Callout
          role="alert"
          type="warning"
          variant="secondary"
          className="rounded-8 border border-tag-warning-border p-panel-compact shadow-none"
        >
          <CalloutContent>
            <CalloutTitle>Details unavailable</CalloutTitle>
            <CalloutDescription className="flex items-center justify-between gap-inline">
              <span>We could not load the resolved configuration for this attempt.</span>
              <Button
                type="button"
                size="2xs"
                variant="secondary"
                onClick={() => void query.refetch()}
              >
                Retry
              </Button>
            </CalloutDescription>
          </CalloutContent>
        </Callout>
      ) : null}
      {detail ? (
        <div className="flex min-w-0 flex-col gap-group">
          {hasInputs ? (
            <InspectorSection title="Inputs">
              <ConfigCode authoredConfig={detail.authoredConfig} resolvedConfig={resolvedConfig} />
            </InspectorSection>
          ) : null}
          {hasOutputs ? (
            <InspectorSection title="Outputs">
              {attempt.outputs !== null || attempt.output !== null ? (
                <JsonCode
                  value={attempt.outputs ?? attempt.output ?? {}}
                  emptyMessage="No outputs declared; the `outputs:` mapping is empty."
                />
              ) : null}
              {attempt.response !== null ? (
                <div className="flex min-w-0 flex-col gap-tight">
                  <Text size="xs" className="text-foreground-neutral-muted">
                    Response
                  </Text>
                  <pre className="max-h-160 min-w-0 overflow-auto rounded-6 border border-border-neutral-base bg-background-neutral-subtle p-tight font-code text-xs leading-18 text-foreground-neutral-muted scrollbar">
                    {attempt.response}
                  </pre>
                </div>
              ) : null}
            </InspectorSection>
          ) : null}
          {hasTrace ? (
            <InspectorSection title="Evaluation">
              <EvaluationTrace trace={trace ?? []} />
            </InspectorSection>
          ) : null}
          {detailCount === 0 && !showFailure && !hasAnnotations ? <EmptyInspector /> : null}
        </div>
      ) : null}
      {hasAnnotations ? (
        <Link
          to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
          params={{workspaceSlug, projectSlug, workflowRunId}}
          search={workflowRunSearchParams({tab: 'annotations'}, {jobId, runAttempt}) as never}
          className="inline-flex w-fit rounded-4 text-xs text-foreground-highlight-interactive underline-offset-2 hover:underline focus-visible:shadow-button-neutral-focus"
        >
          View {annotationCount} annotation{annotationCount === 1 ? '' : 's'}
        </Link>
      ) : null}
      {!query.isPending && !query.isError && !detail && !showFailure && !hasAnnotations ? (
        <EmptyInspector />
      ) : null}
    </div>
  );
}

function InspectorSection({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="flex min-w-0 flex-col gap-inline" aria-label={title}>
      <Text size="xs" bold className="text-foreground-neutral-base">
        {title}
      </Text>
      {children}
    </section>
  );
}

function ConfigCode({
  authoredConfig,
  resolvedConfig,
}: {
  authoredConfig: Record<string, unknown> | null;
  resolvedConfig: Record<string, unknown> | null;
}) {
  const entries: JsonCodeEntry[] = [
    ...(authoredConfig
      ? [
          {
            filename: 'authored.json',
            label: 'Authored configuration',
            value: authoredConfig,
          },
        ]
      : []),
    ...(resolvedConfig
      ? [
          {
            filename: 'resolved.json',
            label: 'Resolved configuration',
            value: resolvedConfig,
          },
        ]
      : []),
  ];

  if (entries.length === 0) return null;
  return <JsonCodeTabs entries={entries} />;
}

export function EvaluationTrace({trace}: {trace: readonly EvaluationTraceEntry[]}) {
  const keyCounts = new Map<string, number>();

  return (
    <dl className="flex min-w-0 flex-col divide-y divide-border-neutral-base rounded-6 border border-border-neutral-base">
      {trace.map((entry) => {
        if ('dropped' in entry) {
          const keyBase = `limit-${entry.dropped}`;
          const occurrence = keyCounts.get(keyBase) ?? 0;
          keyCounts.set(keyBase, occurrence + 1);
          return (
            <div
              key={`${keyBase}-${occurrence}`}
              className="px-row py-row text-xs text-foreground-neutral-muted"
            >
              {entry.dropped} more evaluation{entry.dropped === 1 ? '' : 's'} not recorded
            </div>
          );
        }

        const empty = entry.value === undefined || entry.value === '';
        const keyBase = `evaluation-${entry.field}-${entry.expression}-${entry.evaluatedAt}-${entry.fillTarget}`;
        const occurrence = keyCounts.get(keyBase) ?? 0;
        keyCounts.set(keyBase, occurrence + 1);
        return (
          <div
            key={`${keyBase}-${occurrence}`}
            className={cn(
              'grid min-w-0 grid-cols-1 gap-inline px-row py-row min-[768px]:grid-cols-[160px_minmax(0,1fr)]',
              entry.degraded && 'border-l border-tag-error-icon',
            )}
          >
            <dt
              className="flex min-w-0 flex-col gap-tight font-code text-xs text-foreground-neutral-muted"
              title={entry.field}
            >
              <span className="block truncate">{entry.field}</span>
              <span className="block break-all text-foreground-neutral-subtle">
                {entry.expression}
              </span>
            </dt>
            <dd className="flex min-w-0 flex-col gap-tight text-xs text-foreground-neutral-base">
              {entry.degraded ? <span className="sr-only">Degraded evaluation</span> : null}
              <div className="break-words font-code">
                {empty ? <span className="text-tag-error-text">(empty)</span> : entry.value}
              </div>
              <div className="flex min-w-0 flex-wrap gap-x-inline gap-y-tight text-foreground-neutral-muted">
                {entry.degraded ? <span className="text-tag-error-text">degraded</span> : null}
                {entry.truncated || entry.exprTruncated ? <span>truncated</span> : null}
              </div>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function InspectorLoading() {
  return (
    <div
      role="status"
      aria-label="Loading troubleshooting details"
      className="flex flex-col gap-inline"
    >
      <Skeleton className="h-16 w-120" />
      <Skeleton className="h-120 w-full" />
    </div>
  );
}

function EmptyInspector() {
  return (
    <Text size="xs" className="text-foreground-neutral-muted">
      No additional troubleshooting details were recorded.
    </Text>
  );
}

function selectedStepError(
  step: Step,
  attemptError: Record<string, unknown> | null,
): StepError | null {
  return toSelectedAttemptError(step, attemptError) ?? step.error;
}

function failureTitle(reason: string | JobStatusReason): string {
  switch (reason) {
    case 'checkout_failed':
      return 'Checkout failed';
    case 'checkout_auth_failed':
      return 'Checkout authentication failed';
    case 'checkout_unavailable':
      return 'Checkout service unavailable';
    case 'checkout_path_invalid':
      return 'Checkout path is invalid';
    case 'checkout_destination_occupied':
      return 'Checkout destination is already occupied';
    case 'git_unavailable':
      return 'Git was unavailable';
    case 'workspace_prep_failed':
      return 'Workspace preparation failed';
    case 'setup_aborted':
      return 'Step setup was aborted';
    case 'config_unresolvable':
      return 'Step configuration could not be resolved';
    case 'output_invalid':
      return 'Step output was invalid';
    case 'agent_config_invalid':
      return 'Agent configuration is invalid';
    case 'agent_invocation_failed':
      return 'Agent invocation failed';
    case 'agent_harness_unavailable':
      return 'Agent harness was unavailable';
    case 'runner_lost':
      return 'Runner stopped responding';
    case 'output_too_large':
      return 'Job output exceeded its size limit';
    case 'timed_out':
      return 'Step timed out';
    case 'step_failed':
      return 'A step failed';
    case 'dependency_not_completed':
      return 'A dependency did not complete';
    case 'condition_false':
      return 'The job condition was false';
    case 'default_gate_rejected':
      return 'The default gate rejected this job';
    case 'condition_rejected':
      return 'The job condition rejected this job';
    case 'condition_errored':
      return 'The job condition could not be evaluated';
    case 'user_cancelled':
      return 'The job was cancelled by a user';
    case 'run_cancelled':
      return 'The run was cancelled';
    case 'unknown':
      return 'The failure reason was not recorded';
    default:
      return 'Step failed';
  }
}

function failureDescription(reason: string | JobStatusReason): string {
  switch (reason) {
    case 'checkout_auth_failed':
      return 'Checkout credentials were rejected. Verify repository access before re-running.';
    case 'checkout_unavailable':
      return 'The checkout service was unavailable. Retry after the service recovers.';
    case 'git_unavailable':
      return 'The runner could not start Git. Check the runner image before re-running.';
    case 'workspace_prep_failed':
      return 'The runner could not prepare its workspace. Review the runner setup details.';
    case 'config_unresolvable':
      return 'The resolved configuration contains a value that could not be evaluated.';
    case 'output_invalid':
      return 'The step returned output that did not match the declared contract.';
    case 'agent_config_invalid':
      return 'The agent configuration is not valid for this step.';
    case 'agent_invocation_failed':
      return 'The agent invocation failed after configuration was accepted.';
    case 'agent_harness_unavailable':
      return 'The runner could not start the agent harness.';
    case 'runner_lost':
      return 'The runner stopped responding before the step completed.';
    case 'output_too_large':
      return 'The materialized job output exceeded its configured size limit.';
    case 'timed_out':
      return 'The step exceeded its configured time limit.';
    case 'dependency_not_completed':
      return 'A required job did not complete, so this job could not start.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The job condition did not allow this job to run.';
    case 'condition_errored':
      return 'The job condition could not be evaluated.';
    case 'default_gate_rejected':
      return 'A required job did not succeed, so this job was not allowed to run.';
    case 'step_failed':
      return 'A step failed before this job could complete.';
    case 'user_cancelled':
    case 'run_cancelled':
      return 'The run was cancelled before this work completed.';
    case 'unknown':
      return 'No machine-readable failure reason was recorded.';
    default:
      return `${humanize(reason)}. Review the details below and re-run after resolving the cause.`;
  }
}

function sourceLinkForFailure(reason: string | JobStatusReason): boolean {
  return (
    reason === 'config_unresolvable' ||
    reason === 'agent_config_invalid' ||
    reason === 'output_invalid' ||
    reason === 'default_gate_rejected' ||
    reason === 'condition_rejected' ||
    reason === 'condition_errored'
  );
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countConfigValues(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((total, item) => total + countConfigValues(item), 0);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce((total, item) => total + countConfigValues(item), 0);
  }
  return value === undefined ? 0 : 1;
}
