import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {
  Callout,
  CalloutActions,
  CalloutContent,
  CalloutDescription,
  CalloutTitle,
} from '@shipfox/react-ui/callout';
import {Panel, PanelBody, PanelRow} from '@shipfox/react-ui/panel';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shipfox/react-ui/sheet';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {TimeTickerProvider, useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn, formatDuration} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useId} from 'react';
import type {
  EvaluationTraceEntry,
  JobStatusReason,
  Step,
  StepAttempt,
  StepAttemptDetail,
  StepAttemptInvocation,
  StepError,
  WorkflowDiagnosticUnavailableField,
} from '#core/workflow-run.js';
import {presentStepAttemptDiagnostics} from '#core/workflow-run.js';
import {useStepAttemptDetailQuery} from '#hooks/api/step-attempt-detail.js';
import {workflowRunSearchParams} from '#routes/inputs.js';
import {humanizeStatus, type StepListEntryModel} from '../step-list/step-list-model.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';
import {
  DiagnosticUnavailableAnnouncement,
  DiagnosticUnavailableField,
} from './diagnostic-unavailable.js';
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
  onViewLogs?: (() => void) | undefined;
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
  onViewLogs,
}: StepInspectorSheetProps) {
  const error = selectedStepError(entry.step, entry.error);
  const inspectorQuery = useStepAttemptDetailQuery(entry.step.id, entry.attempt, {
    enabled: open,
    polling: open && entry.status === 'running',
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{entry.step.label}</SheetTitle>
          <div className="flex min-w-0 flex-wrap items-center gap-inline">
            <SheetDescription>
              Attempt #{entry.attempt} · {humanizeStatus(entry.statusVisual.kind)}
            </SheetDescription>
            {entry.step.toolConfig?.sensitivity === 'write' ? (
              <Badge variant="warning" size="2xs" radius="rounded">
                Write tool
              </Badge>
            ) : null}
          </div>
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
            onViewLogs={onViewLogs}
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
  onViewLogs,
  onViewConfiguration,
}: {
  step: Step;
  attempt: StepAttempt;
  error: StepError | null;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
  onViewLogs: (() => void) | undefined;
  onViewConfiguration: (() => void) | undefined;
}) {
  const reason = error?.reason ?? step.statusReason ?? 'unknown';
  const guidance =
    workflowPayloadFailureGuidance(reason, error) ??
    toolFailureGuidance(reason, step, attempt, error);
  const title = guidance?.title ?? failureTitle(reason);
  const description = guidance?.description ?? failureDescription(reason, step, error);
  const failureCode = step.type === 'tool' ? (error?.code ?? reason) : reason;
  const showSourceLink = Boolean(sourceLinkForFailure(reason) && step.sourceLocation);

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
            <div className="flex min-w-0 flex-1 flex-col gap-tight">
              <span>{description}</span>
              <FailureMessage reason={reason} message={error?.message} />
              <WorkflowPayloadSizeDetails reason={reason} error={error} />
            </div>
            <Code as="span" variant="label" className="text-tag-error-text">
              {failureCode}
            </Code>
            <FailureRecoveryLinks
              showSourceLink={showSourceLink}
              recoveryLabel={guidance?.recoveryLabel}
              step={step}
              attempt={attempt}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              workflowRunId={workflowRunId}
              runAttempt={runAttempt}
            />
          </div>
        </CalloutDescription>
      </CalloutContent>
      <StepFailureActions
        onViewConfiguration={onViewConfiguration}
        onViewLogs={step.type === 'tool' ? onViewLogs : undefined}
      />
    </Callout>
  );
}

function FailureMessage({
  reason,
  message,
}: {
  reason: string | JobStatusReason;
  message: string | undefined;
}) {
  if (!message || isWorkflowPayloadFailure(reason)) return null;
  return <span className="text-foreground-neutral-muted">{message}</span>;
}

function FailureRecoveryLinks({
  showSourceLink,
  recoveryLabel,
  step,
  attempt,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
}: {
  showSourceLink: boolean;
  recoveryLabel: string | undefined;
  step: Step;
  attempt: StepAttempt;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
}) {
  return (
    <>
      {showSourceLink ? (
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
      {recoveryLabel ? (
        <Link
          to="/w/$workspaceSlug/settings/integrations"
          params={{workspaceSlug}}
          className="font-medium text-foreground-highlight-interactive underline-offset-2 hover:underline"
        >
          {recoveryLabel}
        </Link>
      ) : null}
    </>
  );
}

function StepFailureActions({
  onViewConfiguration,
  onViewLogs,
}: {
  onViewConfiguration: (() => void) | undefined;
  onViewLogs: (() => void) | undefined;
}) {
  if (!onViewConfiguration && !onViewLogs) return null;
  return (
    <CalloutActions>
      {onViewConfiguration ? (
        <Button type="button" size="2xs" variant="secondary" onClick={onViewConfiguration}>
          View configuration
        </Button>
      ) : null}
      {onViewLogs ? (
        <Button type="button" size="2xs" variant="secondary" onClick={onViewLogs}>
          View invocation log
        </Button>
      ) : null}
    </CalloutActions>
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
  onViewLogs,
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
  onViewLogs: (() => void) | undefined;
}) {
  const detail = query.data;
  const hasAnnotations = annotationCount !== undefined && annotationCount > 0;
  const configurationSectionId = useId();
  const hasConfigurationDetail = Boolean(
    detail && inspectorHasInputValues(detail.authoredConfig, detail.config),
  );
  const onViewConfiguration =
    hasConfigurationDetail && isConfigurationPayloadFailure(error)
      ? () => {
          const section = document.getElementById(configurationSectionId);
          section?.scrollIntoView?.({behavior: 'smooth', block: 'nearest'});
          section?.focus({preventScroll: true});
        }
      : undefined;

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
          onViewLogs={onViewLogs}
          onViewConfiguration={onViewConfiguration}
        />
      ) : null}
      <InspectorQueryContent
        query={query}
        detail={detail}
        step={step}
        attempt={attempt}
        showFailure={showFailure}
        hasAnnotations={hasAnnotations}
        configurationSectionId={configurationSectionId}
      />
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

function InspectorQueryContent({
  query,
  detail,
  step,
  attempt,
  showFailure,
  hasAnnotations,
  configurationSectionId,
}: {
  query: ReturnType<typeof useStepAttemptDetailQuery>;
  detail: ReturnType<typeof useStepAttemptDetailQuery>['data'];
  step: Step;
  attempt: StepAttempt;
  showFailure: boolean;
  hasAnnotations: boolean;
  configurationSectionId: string;
}) {
  if (query.isPending) return <InspectorLoading />;
  if (query.isError && detail === undefined) {
    return (
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
  if (!detail) {
    return showFailure || hasAnnotations ? null : <EmptyInspector />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-group">
      {query.isError ? <InspectorStaleError query={query} /> : null}
      <InspectorDetailContent
        detail={detail}
        step={step}
        attempt={attempt}
        showFailure={showFailure}
        hasAnnotations={hasAnnotations}
        configurationSectionId={configurationSectionId}
      />
    </div>
  );
}

function InspectorStaleError({query}: {query: ReturnType<typeof useStepAttemptDetailQuery>}) {
  return (
    <Callout
      role="status"
      aria-live="polite"
      type="warning"
      variant="secondary"
      className="rounded-8 border border-tag-warning-border p-panel-compact shadow-none"
    >
      <CalloutContent className="flex items-center justify-between gap-inline">
        <Text size="xs">Could not refresh troubleshooting details.</Text>
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

function InspectorDetailContent({
  detail,
  step,
  attempt,
  showFailure,
  hasAnnotations,
  configurationSectionId,
}: {
  detail: NonNullable<ReturnType<typeof useStepAttemptDetailQuery>['data']>;
  step: Step;
  attempt: StepAttempt;
  showFailure: boolean;
  hasAnnotations: boolean;
  configurationSectionId: string;
}) {
  const trace = detail.evaluationTrace ?? null;
  const resolvedConfig = detail.config ?? null;
  const presentedAttempt = presentStepAttemptDiagnostics(attempt, detail);
  const unavailableFields = detail.oversizedFields ?? [];
  const isToolStep = step.type === 'tool';
  const hasInputValues = inspectorHasInputValues(detail.authoredConfig, resolvedConfig);
  const hasOutputValues = inspectorHasOutputValues(presentedAttempt);
  const hasTraceValues = Boolean(trace?.length);
  const hasAttemptDiagnostics = hasVisibleAttemptDiagnostics(detail);
  const hasDetails =
    hasInputValues ||
    hasOutputValues ||
    hasTraceValues ||
    unavailableFields.length > 0 ||
    hasAttemptDiagnostics;
  return (
    <div className="flex min-w-0 flex-col gap-group">
      {detail.session ? <SessionChip session={detail.session} /> : null}
      {isToolStep ? (
        <ToolStepDetails
          detail={detail}
          attempt={presentedAttempt}
          showFailure={showFailure}
          configurationSectionId={configurationSectionId}
        />
      ) : null}
      {!isToolStep && hasInputValues ? (
        <InspectorSection title="Inputs" id={configurationSectionId}>
          <ConfigCode authoredConfig={detail.authoredConfig} resolvedConfig={resolvedConfig} />
        </InspectorSection>
      ) : null}
      {!isToolStep && hasOutputValues ? <InspectorOutputs attempt={presentedAttempt} /> : null}
      {hasTraceValues ? (
        <InspectorSection title="Evaluation">
          <EvaluationTrace trace={trace ?? []} />
        </InspectorSection>
      ) : null}
      <UnavailableDiagnosticsSection fields={unavailableFields} />
      <AttemptDiagnostics detail={detail} />
      <InspectorEmptyState
        isToolStep={isToolStep}
        hasDetails={hasDetails}
        showFailure={showFailure}
        hasAnnotations={hasAnnotations}
      />
    </div>
  );
}

function inspectorHasInputValues(
  authoredConfig: Record<string, unknown> | null,
  resolvedConfig: Record<string, unknown> | null,
): boolean {
  return countConfigValues(authoredConfig) > 0 || countConfigValues(resolvedConfig) > 0;
}

function inspectorHasOutputValues(attempt: StepAttempt): boolean {
  return attempt.outputs !== null || attempt.output !== null || attempt.response !== null;
}

function UnavailableDiagnosticsSection({
  fields,
}: {
  fields: readonly WorkflowDiagnosticUnavailableField[];
}) {
  if (fields.length === 0) return null;
  return (
    <InspectorSection title="Unavailable diagnostics">
      {fields.map((field) => (
        <DiagnosticUnavailableField
          key={`${field.field}-${field.storedBytes}`}
          field={field.field}
          storedBytes={field.storedBytes}
          reason={field.reason}
        />
      ))}
      <DiagnosticUnavailableAnnouncement count={fields.length} />
    </InspectorSection>
  );
}

function AttemptDiagnostics({detail}: {detail: StepAttemptDetail}) {
  if (!hasVisibleAttemptDiagnostics(detail)) return null;

  return (
    <InspectorSection title="Attempt diagnostics">
      {hasDiagnosticObject(detail.error) ? (
        <JsonCode title="failure.json" value={detail.error} />
      ) : null}
      {hasVisibleGateResult(detail.gateResult) ? (
        <JsonCode title="gate-result.json" value={detail.gateResult} />
      ) : null}
      {detail.restartFeedback ? (
        <div className="flex min-w-0 flex-col gap-tight">
          <Text size="xs" className="text-foreground-neutral-muted">
            Restart feedback
          </Text>
          <Text size="xs" className="whitespace-pre-wrap text-foreground-neutral-base">
            {detail.restartFeedback}
          </Text>
        </div>
      ) : null}
    </InspectorSection>
  );
}

function hasDiagnosticObject(value: Record<string, unknown> | null | undefined): boolean {
  return value !== null && value !== undefined && Object.keys(value).length > 0;
}

function hasVisibleGateResult(gateResult: StepAttemptDetail['gateResult']): boolean {
  return (
    gateResult !== undefined &&
    gateResult !== null &&
    gateResult.kind !== 'none' &&
    gateResult.kind !== 'not_evaluated'
  );
}

function hasVisibleAttemptDiagnostics(detail: StepAttemptDetail): boolean {
  return (
    hasDiagnosticObject(detail.error) ||
    hasVisibleGateResult(detail.gateResult) ||
    Boolean(detail.restartFeedback)
  );
}

function InspectorEmptyState({
  isToolStep,
  hasDetails,
  showFailure,
  hasAnnotations,
}: {
  isToolStep: boolean;
  hasDetails: boolean;
  showFailure: boolean;
  hasAnnotations: boolean;
}) {
  if (isToolStep || hasDetails || showFailure || hasAnnotations) return null;
  return <EmptyInspector />;
}

function ToolStepDetails({
  detail,
  attempt,
  showFailure,
  configurationSectionId,
}: {
  detail: StepAttemptDetail;
  attempt: StepAttempt;
  showFailure: boolean;
  configurationSectionId: string;
}) {
  const result = toolResult(attempt);
  const mappedOutputs = toolMappedOutputs(attempt);
  return (
    <>
      {countConfigValues(detail.authoredConfig) > 0 ? (
        <InspectorSection title="Authored configuration" id={configurationSectionId}>
          <ConfigCode authoredConfig={detail.authoredConfig} resolvedConfig={null} />
        </InspectorSection>
      ) : null}
      <InspectorSection title="Arguments">
        <JsonCode
          title="arguments.json"
          value={detail.toolArguments ?? {}}
          emptyMessage="No arguments were passed to this tool."
        />
      </InspectorSection>
      {!showFailure && result.present ? (
        <InspectorSection title="Result">
          <JsonCode title="result.json" value={result.value} />
        </InspectorSection>
      ) : null}
      <InspectorSection title="Invocations">
        <ToolInvocationList attempt={attempt} />
      </InspectorSection>
      {mappedOutputs ? (
        <InspectorSection title="Outputs">
          <JsonCode value={mappedOutputs} />
        </InspectorSection>
      ) : null}
      {attempt.response !== null ? <InspectorResponse response={attempt.response} /> : null}
    </>
  );
}

function ToolInvocationList({attempt}: {attempt: StepAttempt}) {
  const {invocations} = attempt;
  if (invocations.length === 0) {
    return (
      <Text size="xs" className="text-foreground-neutral-muted">
        No provider calls were recorded for this attempt.
      </Text>
    );
  }

  return (
    <Panel>
      <PanelBody asChild>
        <ol>
          {invocations.map((invocation) => (
            <ToolInvocationRow
              key={invocation.callIndex}
              invocation={invocation}
              attemptActive={attempt.status === 'running'}
            />
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}

function ToolInvocationRow({
  invocation,
  attemptActive,
}: {
  invocation: StepAttemptInvocation;
  attemptActive: boolean;
}) {
  const visual = invocationVisual(invocation, attemptActive);
  return (
    <PanelRow asChild className="hover:bg-background-neutral-base">
      <li>
        <div className="flex min-w-0 items-center gap-inline">
          <Code as="span" variant="label" className="shrink-0 text-foreground-neutral-base">
            Call {invocation.callIndex + 1}
          </Code>
          <Badge variant={visual.badge} size="2xs" radius="rounded">
            {visual.label}
          </Badge>
          {invocation.errorCode ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Code
                  as="span"
                  variant="label"
                  tabIndex={0}
                  className="truncate rounded-4 text-foreground-neutral-muted focus-visible:shadow-border-interactive-with-active focus-visible:outline-none"
                >
                  {invocation.errorCode}
                </Code>
              </TooltipTrigger>
              <TooltipContent>
                <span className="block max-w-320 break-all">{invocation.errorCode}</span>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <InvocationTiming invocation={invocation} attemptActive={attemptActive} />
      </li>
    </PanelRow>
  );
}

function InvocationTiming({
  invocation,
  attemptActive,
}: {
  invocation: StepAttemptInvocation;
  attemptActive: boolean;
}) {
  if (attemptActive && invocation.nextDueAt && invocation.outcome === undefined) {
    return (
      <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={1000}>
        <RetryCountdown dueAt={invocation.nextDueAt} />
      </TimeTickerProvider>
    );
  }
  if (invocation.durationMs === undefined) return null;
  return (
    <Code as="span" variant="label" className="shrink-0 text-foreground-neutral-muted">
      {formatDuration(invocation.durationMs)}
    </Code>
  );
}

function RetryCountdown({dueAt}: {dueAt: string}) {
  useTimeTick();
  const remainingMs = Date.parse(dueAt) - Date.now();
  const label = retryCountdownLabel(remainingMs);
  return (
    <Code as="span" variant="label" className="shrink-0 tabular-nums text-foreground-neutral-muted">
      Retry in {label}
    </Code>
  );
}

function retryCountdownLabel(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return 'pending';
  if (remainingMs <= 0) return 'now';
  return `${Math.ceil(remainingMs / 1000)}s`;
}

function invocationVisual(
  invocation: StepAttemptInvocation,
  attemptActive: boolean,
): {
  label: string;
  badge: 'neutral' | 'info' | 'success' | 'warning' | 'error';
} {
  if (invocation.outcome === 'success') return {label: 'Succeeded', badge: 'success'};
  if (invocation.outcome === 'error') return {label: 'Failed', badge: 'error'};
  if (invocation.outcome) return {label: humanizeStatus(invocation.outcome), badge: 'neutral'};
  if (!attemptActive) {
    return invocation.nextDueAt
      ? {label: 'Not retried', badge: 'neutral'}
      : {label: 'Interrupted', badge: 'warning'};
  }
  return invocation.nextDueAt
    ? {label: 'Retry pending', badge: 'warning'}
    : {label: 'Running', badge: 'info'};
}

function toolResult(attempt: StepAttempt): {present: boolean; value?: unknown} {
  for (const output of [attempt.output, attempt.outputs]) {
    if (output && Object.hasOwn(output, 'result')) return {present: true, value: output.result};
  }
  return {present: false};
}

function toolMappedOutputs(attempt: StepAttempt): Record<string, unknown> | null {
  const output = attempt.outputs ?? attempt.output;
  if (!output) return null;
  const mapped = Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'result'));
  return Object.keys(mapped).length > 0 ? mapped : null;
}

function InspectorOutputs({attempt}: {attempt: StepAttempt}) {
  return (
    <InspectorSection title="Outputs">
      {attempt.outputs !== null || attempt.output !== null ? (
        <JsonCode
          value={attempt.outputs ?? attempt.output ?? {}}
          emptyMessage="No outputs declared; the `outputs:` mapping is empty."
        />
      ) : null}
      {attempt.response !== null ? <InspectorResponse response={attempt.response} /> : null}
    </InspectorSection>
  );
}

function InspectorResponse({response}: {response: string}) {
  return (
    <div className="flex min-w-0 flex-col gap-tight">
      <Text size="xs" className="text-foreground-neutral-muted">
        Response
      </Text>
      <pre className="max-h-160 min-w-0 overflow-auto rounded-6 border border-border-neutral-base bg-background-neutral-subtle p-tight font-code text-xs leading-18 text-foreground-neutral-muted scrollbar">
        {response}
      </pre>
    </div>
  );
}

function SessionChip({session}: {session: NonNullable<StepAttemptDetail['session']>}) {
  return (
    <Badge
      variant="feature"
      size="2xs"
      radius="rounded"
      role="group"
      aria-label={`Agent session ${session.key}, ${session.mode} mode, ${session.segment === 0 ? 'no prior session loaded' : `segment ${session.segment} loaded`}`}
      className="w-fit max-w-full font-code"
    >
      <span className="block min-w-0 truncate">
        Session {session.key} · {session.mode} ·{' '}
        {session.segment === 0 ? 'no prior session loaded' : `segment ${session.segment} loaded`}
      </span>
    </Badge>
  );
}

function InspectorSection({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string | undefined;
}) {
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      className="flex min-w-0 flex-col gap-inline rounded-6 focus:outline-none focus:ring-2 focus:ring-border-interactive-base focus:ring-offset-4"
      aria-label={title}
    >
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
      {trace.map((entry) => (
        <EvaluationTraceRow entry={entry} key={evaluationTraceKey(entry, keyCounts)} />
      ))}
    </dl>
  );
}

function evaluationTraceKey(entry: EvaluationTraceEntry, keyCounts: Map<string, number>): string {
  const keyBase =
    'dropped' in entry
      ? `limit-${entry.dropped}`
      : `evaluation-${entry.field}-${entry.expression}-${entry.evaluatedAt}-${entry.fillTarget}`;
  const occurrence = keyCounts.get(keyBase) ?? 0;
  keyCounts.set(keyBase, occurrence + 1);
  return `${keyBase}-${occurrence}`;
}

function EvaluationTraceRow({entry}: {entry: EvaluationTraceEntry}) {
  if ('dropped' in entry) {
    return (
      <div className="px-row py-row text-xs text-foreground-neutral-muted">
        {entry.dropped} more evaluation{entry.dropped === 1 ? '' : 's'} not recorded
      </div>
    );
  }
  const empty = entry.value === undefined || entry.value === '';
  return (
    <div
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
        <span className="block break-all text-foreground-neutral-subtle">{entry.expression}</span>
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
    case 'agent_inference_credentials_unavailable':
      return 'Inference credentials are unavailable';
    case 'agent_session_key_invalid':
      return 'Agent session key is invalid';
    case 'agent_session_held':
      return 'Agent session is held by another attempt';
    case 'agent_session_harness_mismatch':
      return 'Agent session harness does not match';
    case 'agent_session_unavailable':
      return 'Agent session is unavailable';
    case 'tool_error':
      return 'Tool call failed';
    case 'tool_config_invalid':
      return 'Tool configuration is invalid';
    case 'invocation_interrupted':
      return 'Tool invocation was interrupted';
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

function failureDescription(
  reason: string | JobStatusReason,
  step: Step,
  error: StepError | null,
): string {
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
    case 'agent_inference_credentials_unavailable':
      return 'Shipfox could not obtain inference credentials for this agent. Try again. If the problem continues, check the model provider configuration.';
    case 'agent_session_key_invalid':
      return 'The resolved agent session key does not match the allowed key format.';
    case 'agent_session_held':
      return 'Another running step currently holds this agent session. Parallel steps cannot share a session in resume mode.';
    case 'agent_session_harness_mismatch':
      return 'The step harness differs from the harness the agent session is pinned to.';
    case 'agent_session_unavailable':
      return 'The agent session was unavailable during dispatch. Review the error details below and retry after resolving the cause.';
    case 'tool_error':
      return 'The provider rejected or could not complete this tool call.';
    case 'tool_config_invalid':
      return error?.field
        ? `The resolved ${error.field} value is invalid. Fix the step configuration before re-running.`
        : 'The resolved tool configuration is invalid. Fix the step configuration before re-running.';
    case 'invocation_interrupted':
      return step.toolConfig?.sensitivity === 'write'
        ? 'The provider call was interrupted. Confirm whether the write completed before re-running it.'
        : 'The provider call was interrupted before its outcome could be recorded. Review the invocation log before retrying.';
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

interface FailureGuidance {
  title: string;
  description: string;
  recoveryLabel?: string | undefined;
}

const TOOL_FAILURE_GUIDANCE_BY_CODE: Readonly<Record<string, FailureGuidance>> = {
  'access-denied': {
    title: 'Tool access was denied',
    description:
      'The integration rejected this call. Review its permissions before re-running the step.',
    recoveryLabel: 'Review integration access',
  },
  'credentials-unavailable': {
    title: 'Tool credentials are unavailable',
    description:
      'The integration credentials are missing or unavailable. Reconnect the integration before re-running the step.',
    recoveryLabel: 'Reconnect integration',
  },
};

const SUCCESSFUL_TOOL_OUTPUT_FAILURE_GUIDANCE: FailureGuidance = {
  title: 'Tool call succeeded, but the step failed',
  description:
    'The integration returned a result, but Shipfox could not map or store it because it did not satisfy the output contract or size limit. The full result remains available in the invocation log.',
};

function toolFailureGuidance(
  reason: string | JobStatusReason,
  step: Step,
  attempt: StepAttempt,
  error: StepError | null,
): FailureGuidance | null {
  if (step.type !== 'tool') return null;
  if (toolCallSucceededBeforeFailure(reason, attempt)) {
    return SUCCESSFUL_TOOL_OUTPUT_FAILURE_GUIDANCE;
  }
  return error?.code ? (TOOL_FAILURE_GUIDANCE_BY_CODE[error.code] ?? null) : null;
}

function isWorkflowPayloadFailure(reason: string | JobStatusReason): boolean {
  return (
    reason === 'execution_payload_too_large' ||
    reason === 'step_result_too_large' ||
    reason === 'diagnostic_too_large'
  );
}

function isConfigurationPayloadFailure(error: StepError | null): boolean {
  if (error?.reason !== 'execution_payload_too_large') return false;
  return (
    error.field === 'authored_config' ||
    error.field === 'resolved_config' ||
    error.field === 'config_plan' ||
    error.field === 'condition'
  );
}

function workflowPayloadFailureGuidance(
  reason: string | JobStatusReason,
  error: StepError | null,
): FailureGuidance | null {
  const fieldLabel = workflowPayloadFieldLabel(error?.field);
  if (reason === 'execution_payload_too_large') {
    if (error?.field === 'listener_batch') {
      return {
        title: 'Trigger events exceed the execution limit',
        description:
          'Adjust the listener batch or source event before starting a new run. Re-running failed jobs preserves the same trigger events.',
      };
    }
    return {
      title: `${fieldLabel} exceeds the execution limit`,
      description:
        "Reduce the authored value or its upstream input before starting a new run. Re-running failed jobs preserves this attempt's inputs; re-running all jobs can recompute upstream outputs.",
    };
  }
  if (reason === 'step_result_too_large') {
    const resultFieldLabel = error?.field ? workflowPayloadFieldLabel(error.field) : 'Step result';
    return {
      title: `${resultFieldLabel} exceeds the step result limit`,
      description:
        "Reduce the user-controlled result before re-running. Re-running failed jobs preserves this attempt's inputs.",
    };
  }
  if (reason === 'diagnostic_too_large') {
    return {
      title: 'Step details could not be recorded',
      description:
        'The workflow outcome was preserved, but this server could not retain all troubleshooting details. Review the bounded details available below.',
    };
  }
  return null;
}

function WorkflowPayloadSizeDetails({
  reason,
  error,
}: {
  reason: string | JobStatusReason;
  error: StepError | null;
}) {
  if (!isWorkflowPayloadFailure(reason) || !error) return null;
  const measuredBytes = validByteCount(error.measuredBytes);
  const limitBytes = validByteCount(error.limitBytes);
  if (!error.field && measuredBytes === null && limitBytes === null) return null;

  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-inline gap-y-tight text-xs text-foreground-neutral-muted">
      {error.field ? (
        <>
          <dt>Affected value</dt>
          <dd className="text-foreground-neutral-base">{workflowPayloadFieldLabel(error.field)}</dd>
        </>
      ) : null}
      {measuredBytes !== null ? (
        <>
          <dt>Measured</dt>
          <dd className="font-code text-foreground-neutral-base">
            {measuredBytes.toLocaleString()} bytes
          </dd>
        </>
      ) : null}
      {limitBytes !== null ? (
        <>
          <dt>Limit</dt>
          <dd className="font-code text-foreground-neutral-base">
            {limitBytes.toLocaleString()} bytes
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function validByteCount(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

function workflowPayloadFieldLabel(field: string | undefined): string {
  switch (field) {
    case 'authored_config':
      return 'Authored configuration';
    case 'resolved_config':
      return 'Resolved configuration';
    case 'config_plan':
      return 'Configuration plan';
    case 'condition':
      return 'Condition input';
    case 'listener_batch':
    case 'trigger_events':
      return 'Trigger events';
    case 'response':
      return 'Response';
    case 'output':
      return 'Step output';
    case 'outputs':
      return 'Outputs';
    case 'error':
      return 'Failure details';
    case 'gate_result':
      return 'Gate result';
    case 'restart_feedback':
      return 'Restart feedback';
    default:
      return 'Workflow value';
  }
}

function sourceLinkForFailure(reason: string | JobStatusReason): boolean {
  return (
    reason === 'config_unresolvable' ||
    reason === 'agent_config_invalid' ||
    reason === 'tool_config_invalid' ||
    reason === 'output_invalid' ||
    reason === 'default_gate_rejected' ||
    reason === 'condition_rejected' ||
    reason === 'condition_errored'
  );
}

function toolCallSucceededBeforeFailure(
  reason: string | JobStatusReason,
  attempt: StepAttempt,
): boolean {
  return (
    reason === 'output_invalid' &&
    attempt.invocations.some((invocation) => invocation.outcome === 'success')
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
