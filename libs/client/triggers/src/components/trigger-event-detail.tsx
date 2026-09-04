import {useProjectQuery, useProjectsInfiniteQuery} from '@shipfox/client-projects';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
} from '@shipfox/react-ui/code-block';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn, formatBytes} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {useMemo} from 'react';
import type {
  TriggerEventDetail as TriggerEventDetailModel,
  TriggerEventMatchedWorkflowResult,
} from '#core/trigger-event.js';
import {getTriggerEventIssueCallout, type TriggerEventIssue} from '#core/trigger-event-issues.js';
import {useTriggerEventQuery} from '#hooks/api/trigger-events.js';
import {triggerEventResult} from './trigger-event-result.js';
import {TriggerSourceIcon} from './trigger-source-icon.js';

const DETAIL_RAIL_CLASS =
  '@min-[820px]:sticky @min-[820px]:top-16 @min-[820px]:max-h-[calc(var(--app-content-h,100dvh_-_96px)_-_32px)] @min-[820px]:min-h-[min(320px,calc(var(--app-content-h,100dvh_-_96px)_-_32px))]';

export interface TriggerEventDetailProps {
  workspaceId?: string | undefined;
  workspaceSlug?: string | undefined;
  eventId?: string | undefined;
  onBack: () => void;
}

export function TriggerEventDetail({
  workspaceId,
  workspaceSlug,
  eventId,
  onBack,
}: TriggerEventDetailProps) {
  const query = useTriggerEventQuery(eventId);

  if (!eventId) return <TriggerEventDetailPlaceholder />;
  if (query.data) {
    return (
      <TriggerEventDetailView
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        event={query.data}
        onBack={onBack}
      />
    );
  }
  if (query.isError)
    return <TriggerEventDetailError onBack={onBack} onRetry={() => query.refetch()} />;
  return <TriggerEventDetailLoading onBack={onBack} />;
}

export function TriggerEventDetailView({
  workspaceId,
  workspaceSlug,
  event,
  onBack,
}: {
  workspaceId?: string | undefined;
  workspaceSlug?: string | undefined;
  event: TriggerEventDetailModel;
  onBack: () => void;
}) {
  const result = triggerEventResult(event);
  const eventLabel = triggerEventDisplayLabel(event);
  const fullEventLabel = triggerEventFullLabel(event);
  const formattedPayload = useMemo(
    () => JSON.stringify(event.payload ?? null, null, 2) ?? 'null',
    [event.payload],
  );

  return (
    <aside
      aria-label="Event details"
      className={cn(DETAIL_RAIL_CLASS, 'flex min-h-0 flex-col gap-group')}
    >
      <div className="flex shrink-0 flex-col gap-cluster p-panel-compact">
        <Button
          type="button"
          variant="transparentMuted"
          size="sm"
          iconLeft="arrowLeftLine"
          className="self-start @min-[820px]:hidden"
          onClick={onBack}
        >
          Back to events
        </Button>
        <div className="flex min-w-0 items-start justify-between gap-cluster">
          <div className="flex min-w-0 flex-col gap-tight">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={fullEventLabel}
                  className="flex min-w-0 items-center gap-inline rounded-6 border-0 bg-transparent p-0 text-left outline-none focus-visible:shadow-button-neutral-focus"
                >
                  <TriggerSourceIcon
                    provider={event.provider}
                    source={event.source}
                    aria-hidden="true"
                    className="size-16 shrink-0 text-foreground-neutral-muted"
                  />
                  <Code as="span" variant="label" className="truncate text-foreground-neutral-base">
                    {eventLabel}
                  </Code>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <Code as="span" variant="label" className="block max-w-[360px] break-words">
                  {fullEventLabel}
                </Code>
              </TooltipContent>
            </Tooltip>
            <Text size="xs" className="truncate text-foreground-neutral-muted">
              <RelativeTime value={event.receivedAt} />
            </Text>
          </div>
          <Badge variant={result.badge} size="xs">
            {result.label}
          </Badge>
        </div>
      </div>

      <div
        key={event.id}
        className="flex min-h-0 flex-1 flex-col gap-group overflow-y-auto scrollbar"
      >
        <EventIssueCallout event={event} />
        <EventRuns workspaceId={workspaceId} workspaceSlug={workspaceSlug} event={event} />
        <EventPayload payload={formattedPayload} />
      </div>
    </aside>
  );
}

function EventIssueCallout({event}: {event: TriggerEventDetailModel}) {
  const callout = getTriggerEventIssueCallout(event);
  if (callout === null) return null;
  const firstIssue = callout.issues[0];
  if (firstIssue === undefined) return null;

  return (
    <Callout type={callout.type}>
      <CalloutContent>
        <CalloutTitle>{callout.title}</CalloutTitle>
        <CalloutDescription>
          {callout.successSummary === null ? null : (
            <p className="mb-tight">{callout.successSummary}</p>
          )}
          {callout.issues.length === 1 ? (
            <IssueDescription issue={firstIssue} />
          ) : (
            <ul className="flex flex-col gap-tight">
              {callout.issues.map((issue) => (
                <li key={issue.id}>
                  <span className="font-medium text-foreground-neutral-base">
                    {issue.affectedCount > 1
                      ? `${issue.affectedCount} affected decisions`
                      : (issue.targetName ?? issue.title)}
                    :
                  </span>{' '}
                  <IssueDescription issue={issue} />
                </li>
              ))}
            </ul>
          )}
          {callout.hiddenIssueCount > 0 ? (
            <Text as="p" size="xs" className="mt-tight text-foreground-neutral-muted">
              {callout.hiddenIssueCount} more{' '}
              {callout.hiddenIssueCount === 1 ? 'issue was' : 'issues were'} recorded.
            </Text>
          ) : null}
        </CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}

function IssueDescription({issue}: {issue: TriggerEventIssue}) {
  return issue.description.map((part, index) => {
    const key = `${part.kind}:${index}`;
    if (part.kind === 'code') {
      return (
        <Code key={key} as="span" variant="label">
          {part.value}
        </Code>
      );
    }
    return <span key={key}>{part.kind === 'bytes' ? formatBytes(part.value) : part.value}</span>;
  });
}

function triggerEventDisplayLabel(event: Pick<TriggerEventDetailModel, 'event' | 'source'>) {
  return event.event || event.source;
}

function triggerEventFullLabel(event: Pick<TriggerEventDetailModel, 'event' | 'source'>) {
  return [event.source, event.event].filter(Boolean).join(' · ');
}

function TriggerEventDetailPlaceholder() {
  return (
    <aside aria-label="Event details" className="hidden min-h-[240px] @min-[820px]:flex">
      <Panel className="flex min-h-0 flex-1 items-center justify-center p-panel">
        <EmptyState icon="pulseLine" variant="compact" title="No event selected" />
      </Panel>
    </aside>
  );
}

function TriggerEventDetailLoading({onBack}: {onBack: () => void}) {
  return (
    <aside
      aria-label="Event details"
      className={cn(DETAIL_RAIL_CLASS, 'flex min-h-[320px] flex-col')}
    >
      <Panel className="flex min-h-[320px] flex-col gap-group p-panel-compact">
        <Button
          type="button"
          variant="transparentMuted"
          size="sm"
          iconLeft="arrowLeftLine"
          className="self-start @min-[820px]:hidden"
          onClick={onBack}
        >
          Back to events
        </Button>
        <div className="flex flex-col gap-inline">
          <Skeleton className="h-16 w-160" />
          <Skeleton className="h-12 w-120" />
        </div>
        <Skeleton className="h-96" />
        <Skeleton className="h-160" />
      </Panel>
    </aside>
  );
}

function TriggerEventDetailError({onBack, onRetry}: {onBack: () => void; onRetry: () => void}) {
  return (
    <aside
      aria-label="Event details"
      className={cn(DETAIL_RAIL_CLASS, 'flex min-h-[320px] flex-col')}
    >
      <Panel className="flex min-h-[320px] flex-col gap-group p-panel-compact">
        <Button
          type="button"
          variant="transparentMuted"
          size="sm"
          iconLeft="arrowLeftLine"
          className="self-start @min-[820px]:hidden"
          onClick={onBack}
        >
          Back to events
        </Button>
        <Callout role="alert" type="error">
          <div className="flex items-center justify-between gap-cluster">
            <Text size="sm">Event detail could not be loaded.</Text>
            <Button type="button" variant="secondary" size="xs" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </Callout>
      </Panel>
    </aside>
  );
}

function EventRuns({
  workspaceId,
  workspaceSlug,
  event,
}: {
  workspaceId?: string | undefined;
  workspaceSlug?: string | undefined;
  event: TriggerEventDetailModel;
}) {
  if (event.decisions.length === 0) {
    if (event.outcome === 'discarded') {
      return (
        <Panel>
          <PanelBody className="p-panel-compact">
            <Text size="sm" className="text-foreground-neutral-muted">
              No workflow matched this event.
            </Text>
          </PanelBody>
        </Panel>
      );
    }
    return null;
  }

  if (!workspaceId) {
    return <EventRunsList workspaceSlug={workspaceSlug} projectSlugs={new Map()} event={event} />;
  }

  return (
    <EventRunsWithProjects workspaceId={workspaceId} workspaceSlug={workspaceSlug} event={event} />
  );
}

function EventRunsWithProjects({
  workspaceId,
  workspaceSlug,
  event,
}: {
  workspaceId: string;
  workspaceSlug?: string | undefined;
  event: TriggerEventDetailModel;
}) {
  const projectsQuery = useProjectsInfiniteQuery(workspaceId);
  const projectSlugs = useMemo(
    () =>
      new Map(
        projectsQuery.data?.pages
          .flatMap((page) => page.projects)
          .map((project) => [project.id, project.slug] as const),
      ),
    [projectsQuery.data],
  );
  return (
    <EventRunsList
      workspaceSlug={workspaceSlug}
      projectSlugs={projectSlugs}
      projectDetailLookupEnabled={!projectsQuery.isPending}
      event={event}
    />
  );
}

function EventRunsList({
  workspaceSlug,
  projectSlugs,
  projectDetailLookupEnabled = false,
  event,
}: {
  workspaceSlug?: string | undefined;
  projectSlugs: ReadonlyMap<string, string>;
  projectDetailLookupEnabled?: boolean;
  event: TriggerEventDetailModel;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Workflow decisions</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <ul>
          {event.decisions.map((decision) => (
            <DecisionRow
              key={decision.id}
              workspaceSlug={workspaceSlug}
              projectId={decision.projectId ?? undefined}
              projectSlug={decision.projectId ? projectSlugs.get(decision.projectId) : undefined}
              projectDetailLookupEnabled={projectDetailLookupEnabled}
              decision={decision}
            />
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}

function DecisionRow({
  projectId,
  projectSlug,
  workspaceSlug,
  projectDetailLookupEnabled,
  decision,
}: {
  projectId?: string | undefined;
  projectSlug?: string | undefined;
  workspaceSlug?: string | undefined;
  projectDetailLookupEnabled: boolean;
  decision: TriggerEventMatchedWorkflowResult;
}) {
  const canRenderRunLink =
    decision.decision === 'triggered' && Boolean(decision.runId && decision.runName);
  const projectQuery = useProjectQuery(
    canRenderRunLink && projectDetailLookupEnabled && !projectSlug ? projectId : undefined,
  );
  const resolvedProjectSlug = projectSlug ?? projectQuery.data?.slug;
  const status = failedDecisionStatus(decision.decision);

  if (decision.decision !== 'triggered' || !decision.runId || !decision.runName) {
    return (
      <li className="border-b border-border-neutral-base px-row py-row last:border-b-0">
        <div className="flex min-w-0 items-start gap-inline">
          <Icon
            name="cornerDownRightLine"
            className="size-14 shrink-0 text-foreground-neutral-disabled"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col gap-tight">
            <Text size="sm" className="min-w-0 truncate text-foreground-neutral-base">
              {decision.subscriptionName}
            </Text>
            <Text size="xs" className={status.className}>
              {status.label}
            </Text>
          </div>
        </div>
      </li>
    );
  }

  const row = (
    <>
      <Icon
        name="cornerDownRightLine"
        className="size-14 shrink-0 text-foreground-neutral-muted"
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-col gap-tight">
        <Text as="span" size="sm" className="min-w-0 truncate text-foreground-neutral-base">
          {decision.subscriptionName}
        </Text>
        <Code as="span" variant="label" className="truncate text-foreground-neutral-muted">
          {decision.runName}
        </Code>
      </span>
    </>
  );
  const rowClassName =
    'flex min-w-0 items-start gap-inline px-row py-row hover:bg-background-neutral-hover focus-visible:outline-none focus-visible:shadow-button-neutral-focus';

  return (
    <li className="border-b border-border-neutral-base last:border-b-0">
      {workspaceSlug && resolvedProjectSlug ? (
        <Link
          to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
          params={{
            workspaceSlug,
            projectSlug: resolvedProjectSlug,
            workflowRunId: decision.runId,
          }}
          className={rowClassName}
        >
          {row}
        </Link>
      ) : (
        <div className={rowClassName}>{row}</div>
      )}
    </li>
  );
}

function failedDecisionStatus(decision: TriggerEventMatchedWorkflowResult['decision']): {
  label: string;
  className: string;
} {
  if (decision === 'filtered') {
    return {label: 'Filter did not match', className: 'text-foreground-neutral-disabled'};
  }
  if (decision === 'filter-error') {
    return {label: 'Filter could not be evaluated', className: 'text-foreground-highlight-error'};
  }
  return {label: 'No run created', className: 'text-foreground-highlight-error'};
}

function EventPayload({payload}: {payload: string}) {
  const data = [{language: 'json', filename: 'payload.json', code: payload}];

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Payload</PanelTitle>
      </PanelHeader>
      <PanelBody className="p-0">
        <CodeBlock
          data={data}
          className="flex h-auto flex-col overflow-visible rounded-none bg-background-contrast-base shadow-none"
        >
          <CodeBlockHeader className="sticky top-0 z-10 shrink-0 border-b border-border-contrast-base bg-background-contrast-base p-tight">
            <CodeBlockFiles>
              {(item) => (
                <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>
              )}
            </CodeBlockFiles>
            <CodeBlockCopyButton />
          </CodeBlockHeader>
          <CodeBlockBody className="min-h-0 scrollbar">
            {(item) => (
              <CodeBlockItem
                value={item.filename}
                lineNumbers={false}
                className="px-0 pb-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-background-contrast-base [&_code]:!text-foreground-neutral-on-color"
              >
                <CodeBlockContent language="json" syntaxHighlighting={false}>
                  {item.code}
                </CodeBlockContent>
              </CodeBlockItem>
            )}
          </CodeBlockBody>
        </CodeBlock>
      </PanelBody>
    </Panel>
  );
}
