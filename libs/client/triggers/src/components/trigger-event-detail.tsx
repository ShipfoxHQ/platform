import {useProjectQuery, useProjectsInfiniteQuery} from '@shipfox/client-projects';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
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
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {useMemo} from 'react';
import type {
  TriggerEventDetail as TriggerEventDetailModel,
  TriggerEventMatchedWorkflowResult,
} from '#core/trigger-event.js';
import {useTriggerEventQuery} from '#hooks/api/trigger-events.js';
import {triggerEventResult} from './trigger-event-result.js';
import {TriggerSourceIcon} from './trigger-source-icon.js';

const PANEL_CLASS =
  'min-h-0 rounded-8 border border-border-neutral-base bg-background-neutral-base';
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
      className={cn(PANEL_CLASS, DETAIL_RAIL_CLASS, 'flex min-h-0 flex-col overflow-hidden')}
    >
      <div className="flex shrink-0 flex-col gap-12 border-b border-border-neutral-base p-16">
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
        <div className="flex min-w-0 items-start justify-between gap-12">
          <div className="flex min-w-0 flex-col gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={fullEventLabel}
                  className="flex min-w-0 items-center gap-6 rounded-6 border-0 bg-transparent p-0 text-left outline-none focus-visible:shadow-button-neutral-focus"
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
        className="flex min-h-0 flex-1 flex-col gap-20 overflow-y-auto p-16 scrollbar"
      >
        <EventRuns workspaceId={workspaceId} workspaceSlug={workspaceSlug} event={event} />
        <EventPayload payload={formattedPayload} />
      </div>
    </aside>
  );
}

function triggerEventDisplayLabel(event: Pick<TriggerEventDetailModel, 'event' | 'source'>) {
  return event.event || event.source;
}

function triggerEventFullLabel(event: Pick<TriggerEventDetailModel, 'event' | 'source'>) {
  return [event.source, event.event].filter(Boolean).join(' · ');
}

function TriggerEventDetailPlaceholder() {
  return (
    <aside
      aria-label="Event details"
      className={cn(
        PANEL_CLASS,
        'hidden min-h-[240px] items-center justify-center p-24 @min-[820px]:flex',
      )}
    >
      <EmptyState icon="pulseLine" variant="compact" title="No event selected" />
    </aside>
  );
}

function TriggerEventDetailLoading({onBack}: {onBack: () => void}) {
  return (
    <aside
      aria-label="Event details"
      className={cn(PANEL_CLASS, DETAIL_RAIL_CLASS, 'flex min-h-[320px] flex-col gap-16 p-16')}
    >
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
      <div className="flex flex-col gap-8">
        <Skeleton className="h-16 w-160" />
        <Skeleton className="h-12 w-120" />
      </div>
      <Skeleton className="h-96" />
      <Skeleton className="h-160" />
    </aside>
  );
}

function TriggerEventDetailError({onBack, onRetry}: {onBack: () => void; onRetry: () => void}) {
  return (
    <aside
      aria-label="Event details"
      className={cn(PANEL_CLASS, DETAIL_RAIL_CLASS, 'flex min-h-[320px] flex-col gap-16 p-16')}
    >
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
        <div className="flex items-center justify-between gap-12">
          <Text size="sm">Event detail could not be loaded.</Text>
          <Button type="button" variant="secondary" size="xs" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </Callout>
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
        <Text size="sm" className="text-foreground-neutral-muted">
          No workflows are subscribed to this event.
        </Text>
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

  return <EventRunsList workspaceSlug={workspaceSlug} projectSlugs={projectSlugs} event={event} />;
}

function EventRunsList({
  workspaceSlug,
  projectSlugs,
  event,
}: {
  workspaceSlug?: string | undefined;
  projectSlugs: ReadonlyMap<string, string>;
  event: TriggerEventDetailModel;
}) {
  return (
    <section aria-labelledby="trigger-event-runs-heading" className="flex flex-col gap-6">
      <Text id="trigger-event-runs-heading" size="sm" bold>
        Matched workflows
      </Text>
      <ul className="-mx-8 flex flex-col gap-1">
        {event.decisions.map((decision) => (
          <DecisionRow
            key={decision.id}
            workspaceSlug={workspaceSlug}
            projectId={decision.projectId ?? undefined}
            projectSlug={decision.projectId ? projectSlugs.get(decision.projectId) : undefined}
            decision={decision}
          />
        ))}
      </ul>
    </section>
  );
}

function DecisionRow({
  projectId,
  projectSlug,
  workspaceSlug,
  decision,
}: {
  projectId?: string | undefined;
  projectSlug?: string | undefined;
  workspaceSlug?: string | undefined;
  decision: TriggerEventMatchedWorkflowResult;
}) {
  const projectQuery = useProjectQuery(projectSlug ? undefined : projectId);
  const resolvedProjectSlug = projectSlug ?? projectQuery.data?.slug;

  if (decision.decision !== 'triggered' || !decision.runId || !decision.runName) {
    return (
      <li className="flex min-w-0 items-start gap-8 rounded-6 px-8 py-6">
        <Icon
          name="cornerDownRightLine"
          className="mt-2 size-14 shrink-0 text-foreground-neutral-disabled"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Text size="sm" className="min-w-0 truncate text-foreground-neutral-base">
            {decision.subscriptionName}
          </Text>
          {decision.reason ? (
            <Text size="xs" className="text-foreground-highlight-error">
              {decision.reason}
            </Text>
          ) : (
            <Text size="xs" className="text-foreground-neutral-disabled">
              No run created
            </Text>
          )}
        </div>
      </li>
    );
  }

  const row = (
    <>
      <Icon
        name="cornerDownRightLine"
        className="mt-3 size-14 shrink-0 text-foreground-neutral-muted"
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-col gap-1">
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
    'flex min-w-0 items-start gap-8 rounded-6 px-8 py-6 hover:bg-background-components-hover focus-visible:outline-none focus-visible:shadow-button-neutral-focus';

  return (
    <li>
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

function EventPayload({payload}: {payload: string}) {
  const data = [{language: 'json', filename: 'payload.json', code: payload}];

  return (
    <section aria-labelledby="trigger-event-payload-heading" className="flex flex-col gap-6">
      <Text id="trigger-event-payload-heading" size="sm" bold>
        Payload
      </Text>
      <CodeBlock
        data={data}
        className="flex h-auto flex-col overflow-visible rounded-8 bg-background-contrast-base shadow-none"
      >
        <CodeBlockHeader className="sticky top-0 z-10 shrink-0 border-b border-border-contrast-base bg-background-contrast-base px-10 py-6">
          <CodeBlockFiles>
            {(item) => <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>}
          </CodeBlockFiles>
          <CodeBlockCopyButton />
        </CodeBlockHeader>
        <CodeBlockBody className="min-h-0 scrollbar">
          {(item) => (
            <CodeBlockItem
              value={item.filename}
              lineNumbers={false}
              className="px-0 pb-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-background-contrast-base [&>div]:dark:bg-background-contrast-base [&_code]:!text-foreground-neutral-on-color"
            >
              <CodeBlockContent language="json" syntaxHighlighting={false}>
                {item.code}
              </CodeBlockContent>
            </CodeBlockItem>
          )}
        </CodeBlockBody>
      </CodeBlock>
    </section>
  );
}
