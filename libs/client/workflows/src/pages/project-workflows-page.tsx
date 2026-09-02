import {ApiError} from '@shipfox/client-api';
import {
  type Definition,
  type DefinitionSyncDiagnostic,
  type DefinitionSyncSummary,
  SourceStrip,
  useDefinitionsInfiniteQuery,
  useProjectQuery,
} from '@shipfox/client-projects';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {Panel} from '@shipfox/react-ui/panel';
import {RelativeTime, RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shipfox/react-ui/sheet';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {type ReactNode, useState} from 'react';
import {useFireManualWorkflowMutation} from '#hooks/api/workflow-runs.js';

export function ProjectWorkflowsPage({projectId}: {projectId: string}) {
  return (
    <RelativeTimeProvider>
      <ProjectWorkflowsPageInner projectId={projectId} />
    </RelativeTimeProvider>
  );
}

function ProjectWorkflowsPageInner({projectId}: {projectId: string}) {
  const projectQuery = useProjectQuery(projectId);
  const definitionsQuery = useDefinitionsInfiniteQuery(projectId);
  const fireManual = useFireManualWorkflowMutation();
  const [selectedDefinition, setSelectedDefinition] = useState<Definition | null>(null);
  const [runError, setRunError] = useState<{definitionId: string; message: string} | null>(null);
  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const sync = definitionsQuery.data?.pages[0]?.sync;

  async function handleRun(definition: Definition) {
    setRunError(null);
    if (!definition.manualTrigger) return;
    try {
      await fireManual.mutateAsync({projectId, definitionId: definition.id});
      toast.success('Run queued');
    } catch (error) {
      const message = errorMessage(error, 'Could not queue run.');
      setRunError({definitionId: definition.id, message});
      toast.error(message);
    }
  }

  let projectErrorContent: ReactNode = null;
  if (projectQuery.isError && projectQuery.data === undefined) {
    projectErrorContent =
      projectQuery.error instanceof ApiError && projectQuery.error.status === 404 ? (
        <EmptyState
          icon="errorWarningLine"
          title="Project not found"
          description="This project doesn't exist, or you don't have access to it."
        />
      ) : (
        <QueryLoadError query={projectQuery} subject="project" />
      );
  }

  return (
    <div className="flex w-full flex-col gap-section">
      <Header variant="h1" className="sr-only">
        Workflows
      </Header>

      {projectQuery.isPending ? (
        <div className="flex flex-col gap-cluster">
          <Skeleton className="h-28 w-1/3" />
          <Skeleton className="h-18 w-1/2" />
        </div>
      ) : null}

      {projectErrorContent}

      {projectQuery.data ? (
        <>
          <SourceStrip
            connectionId={projectQuery.data.source.connectionId}
            externalRepositoryId={projectQuery.data.source.externalRepositoryId}
            sync={sync}
            isPending={definitionsQuery.isPending}
          />

          <WorkflowSyncAlert sync={sync} />
          <WorkflowSyncDiagnostics sync={sync} />

          <WorkflowDefinitionsList
            definitions={definitions}
            isPending={definitionsQuery.isPending}
            isError={definitionsQuery.isError}
            sync={sync ?? null}
            runError={runError}
            runningDefinitionId={
              fireManual.isPending && fireManual.variables
                ? fireManual.variables.definitionId
                : null
            }
            hasNextPage={definitionsQuery.hasNextPage}
            isFetchingNextPage={definitionsQuery.isFetchingNextPage}
            isFetchNextPageError={definitionsQuery.isFetchNextPageError}
            onRetry={() => definitionsQuery.refetch()}
            onLoadMore={() => definitionsQuery.fetchNextPage()}
            onOpenDefinition={setSelectedDefinition}
            onRun={(definition) => {
              void handleRun(definition);
            }}
          />
        </>
      ) : null}

      <DefinitionSheet
        definition={selectedDefinition}
        onOpenChange={(open) => {
          if (!open) setSelectedDefinition(null);
        }}
      />
    </div>
  );
}

function WorkflowDefinitionsList({
  definitions,
  isPending,
  isError,
  sync,
  runError,
  runningDefinitionId,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onRetry,
  onLoadMore,
  onOpenDefinition,
  onRun,
}: {
  definitions: Definition[];
  isPending: boolean;
  isError: boolean;
  sync: DefinitionSyncSummary | null;
  runError: {definitionId: string; message: string} | null;
  runningDefinitionId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenDefinition: (definition: Definition) => void;
  onRun: (definition: Definition) => void;
}) {
  if (isPending) {
    return (
      <Panel role="status" aria-label="Loading workflows" className="divide-y">
        <Skeleton className="h-44 w-full rounded-none" />
        <Skeleton className="h-44 w-full rounded-none" />
        <Skeleton className="h-44 w-full rounded-none" />
      </Panel>
    );
  }

  if (isError && definitions.length === 0) {
    return (
      <Panel role="region" aria-label="Workflow definitions">
        <LoadErrorState
          title="Couldn't load workflows"
          description="Definitions could not be loaded. Source metadata remains visible."
          onRetry={onRetry}
          retryLabel="Retry loading workflows"
          variant="panel"
        />
      </Panel>
    );
  }

  if (definitions.length === 0) {
    return (
      <Panel role="region" aria-label="Workflow definitions">
        <WorkflowEmptyState sync={sync} />
      </Panel>
    );
  }

  return (
    <>
      <Panel role="region" aria-label="Workflow definitions">
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40"></TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead className="w-180">Updated</TableHead>
                <TableHead className="w-80 text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {definitions.map((definition) => {
                const runErrorMessage =
                  runError?.definitionId === definition.id ? runError.message : null;
                const isRunning = runningDefinitionId === definition.id;

                return (
                  // The workflow-name cell holds a `<button>` so the row is
                  // keyboard-reachable (Tab focuses, Enter/Space activates
                  // via native button semantics). The TableRow itself is no
                  // longer clickable: a row-level onClick would be invisible
                  // to keyboard users and require custom keydown handling.
                  // The `group` class on the row still drives the Run button
                  // reveal on hover or focus-within.
                  <TableRow key={definition.id} className="group">
                    <TableCell>
                      <Icon
                        name={sourceIcon(definition.source)}
                        className="size-16 text-foreground-neutral-muted"
                        aria-hidden="true"
                      />
                    </TableCell>
                    <TableCell className="max-w-260">
                      <div className="flex min-w-0 flex-col gap-tight">
                        <button
                          type="button"
                          onClick={() => onOpenDefinition(definition)}
                          className="flex min-w-0 flex-col gap-tight rounded-4 text-left outline-none focus-visible:shadow-border-interactive-with-active"
                        >
                          <Text size="sm" bold className="truncate">
                            {definition.name}
                          </Text>
                          <Code className="truncate text-foreground-neutral-muted">
                            {definition.configPath ?? 'Manual definition'}
                          </Code>
                        </button>
                        {runErrorMessage ? (
                          <Text size="xs" className="text-tag-error-text">
                            {runErrorMessage}
                          </Text>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground-neutral-muted">
                      <RelativeTime value={definition.updatedAt} />
                    </TableCell>
                    <TableCell>
                      {definition.manualTrigger ? (
                        <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Button size="xs" isLoading={isRunning} onClick={() => onRun(definition)}>
                            Run
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col md:hidden">
          {definitions.map((definition) => {
            const runErrorMessage =
              runError?.definitionId === definition.id ? runError.message : null;
            const isRunning = runningDefinitionId === definition.id;

            return (
              <div
                key={definition.id}
                className="flex flex-col gap-inline border-b border-border-neutral-base p-panel-compact last:border-b-0"
              >
                <button
                  type="button"
                  className="flex min-w-0 items-start gap-inline text-left"
                  onClick={() => onOpenDefinition(definition)}
                >
                  <Icon
                    name={sourceIcon(definition.source)}
                    className="size-16 shrink-0 text-foreground-neutral-muted"
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-col gap-tight">
                    <Text size="sm" bold className="break-words">
                      {definition.name}
                    </Text>
                    <Code className="break-words text-foreground-neutral-muted">
                      {definition.configPath ?? 'Manual definition'}
                    </Code>
                  </div>
                </button>
                <div className="flex items-center justify-between gap-inline">
                  <Text size="xs" className="text-foreground-neutral-muted">
                    Updated <RelativeTime value={definition.updatedAt} />
                  </Text>
                  {definition.manualTrigger ? (
                    <Button size="sm" isLoading={isRunning} onClick={() => onRun(definition)}>
                      Run
                    </Button>
                  ) : null}
                </div>
                {runErrorMessage ? (
                  <Text size="xs" className="text-tag-error-text">
                    {runErrorMessage}
                  </Text>
                ) : null}
              </div>
            );
          })}
        </div>
      </Panel>

      {isFetchNextPageError ? (
        <Callout role="alert" type="error">
          <div className="flex items-center justify-between gap-cluster">
            <Text size="sm">Could not load more workflows.</Text>
            <Button size="sm" variant="secondary" onClick={onLoadMore}>
              Retry
            </Button>
          </div>
        </Callout>
      ) : null}

      {hasNextPage ? (
        <div className="flex justify-center">
          <Button size="sm" variant="secondary" isLoading={isFetchingNextPage} onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function sourceIcon(source: 'manual' | 'vcs'): IconName {
  return source === 'vcs' ? ('gitBranchLine' as IconName) : ('terminalLine' as IconName);
}

function WorkflowEmptyState({sync}: {sync: DefinitionSyncSummary | null}) {
  let message = 'Workflow sync has not reported yet.';
  if (sync?.status === 'failed' && sync.lastErrorCode === 'no-workflow-files') {
    message = 'No workflow files found under .shipfox/workflows/.';
  } else if (sync?.status === 'failed') {
    message = sync.lastErrorMessage ?? 'Workflow definitions could not be synced.';
  } else if (sync?.status === 'syncing') {
    message = 'Workflow definitions are being discovered.';
  } else if (sync?.status === 'succeeded') {
    message = 'No workflow definitions found.';
  }

  return <EmptyState icon="flowChart" title="No workflows" description={message} variant="panel" />;
}

function WorkflowSyncAlert({sync}: {sync: DefinitionSyncSummary | null | undefined}) {
  if (sync?.status !== 'failed') return null;

  return (
    <Callout role="alert" type="error">
      <div className="flex flex-col gap-tight">
        <Text size="sm" bold>
          Workflow sync failed
        </Text>
        <Text size="sm">
          {sync.lastErrorMessage ?? 'The latest workflow sync failed before definitions updated.'}
        </Text>
      </div>
    </Callout>
  );
}

function WorkflowSyncDiagnostics({sync}: {sync: DefinitionSyncSummary | null | undefined}) {
  if (
    (sync?.status !== 'succeeded' && sync?.status !== 'failed') ||
    sync.diagnostics.length === 0
  ) {
    return null;
  }

  const hasErrors = sync.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const hasWarnings = sync.diagnostics.some((diagnostic) => diagnostic.severity === 'warning');
  const groups = groupDiagnosticsByFilePath(sync.diagnostics);
  let title = 'Workflow definition warnings';
  if (hasErrors && hasWarnings) title = 'Workflow definition diagnostics';
  else if (hasErrors) title = 'Workflow definition errors';

  return (
    <Callout role="status" type={hasErrors ? 'error' : 'warning'}>
      <div className="flex flex-col gap-inline">
        <Text size="sm" bold>
          {title}
        </Text>
        <ul className="flex flex-col gap-tight">
          {groups.map((group) => (
            <li key={group.key} className="flex flex-col gap-tight">
              {group.filePath ? (
                <Code className="text-foreground-neutral-muted">{group.filePath}</Code>
              ) : null}
              <ul className="flex flex-col gap-tight">
                {group.items.map(({key, diagnostic}) => {
                  const severityLabel = diagnostic.severity === 'error' ? 'Error' : 'Warning';

                  return (
                    <li key={key}>
                      {diagnostic.path ? (
                        <Code className="text-foreground-neutral-muted">{diagnostic.path}</Code>
                      ) : null}
                      <Text size="sm">
                        <span className="font-medium">{severityLabel}:</span>{' '}
                        <span
                          className={
                            diagnostic.severity === 'error' ? 'text-tag-error-text' : undefined
                          }
                        >
                          {diagnostic.message}
                        </span>
                      </Text>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Callout>
  );
}

interface DiagnosticGroup {
  key: string;
  filePath: string | undefined;
  items: {key: string; diagnostic: DefinitionSyncDiagnostic}[];
}

function groupDiagnosticsByFilePath(
  diagnostics: readonly DefinitionSyncDiagnostic[],
): DiagnosticGroup[] {
  const groups: DiagnosticGroup[] = [];
  const indexByFilePath = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const filePathKey = diagnostic.filePath ?? '';
    const groupIndex = indexByFilePath.get(filePathKey);
    if (groupIndex === undefined) {
      indexByFilePath.set(filePathKey, groups.length);
      groups.push({
        key: `${filePathKey}-${groups.length}`,
        filePath: diagnostic.filePath,
        items: [{key: `${filePathKey}-0`, diagnostic}],
      });
    } else {
      const group = groups[groupIndex];
      if (group) group.items.push({key: `${filePathKey}-${group.items.length}`, diagnostic});
    }
  }
  return groups;
}

function DefinitionSheet({
  definition,
  onOpenChange,
}: {
  definition: Definition | null;
  onOpenChange: (open: boolean) => void;
}) {
  const normalizedJson = definition
    ? JSON.stringify(
        {
          workflow_document: definition.workflowDocument,
          workflow_model: definition.workflowModel,
        },
        null,
        2,
      )
    : '';

  return (
    <Sheet open={Boolean(definition)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px]">
        {definition ? (
          <>
            <SheetHeader>
              <SheetTitle>{definition.name}</SheetTitle>
              <SheetDescription>
                {definition.configPath ?? 'Manual workflow definition'}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="gap-group">
              <div className="grid w-full gap-inline">
                <Metadata label="Definition id" value={definition.id} />
                <Metadata label="Source" value={definition.source} />
                <Metadata label="Ref" value={definition.ref ?? 'Not set'} />
                <Metadata label="SHA" value={definition.sha ?? 'Not set'} />
              </div>
              <div className="flex w-full flex-col gap-inline">
                <Text size="sm" bold>
                  Normalized definition
                </Text>
                <pre className="max-h-[52vh] w-full overflow-auto rounded-8 border border-border-neutral-base bg-background-neutral-subtle p-panel-compact scrollbar">
                  <Code as="code" className="whitespace-pre text-foreground-neutral-base">
                    {normalizedJson}
                  </Code>
                </pre>
              </div>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Metadata({label, value}: {label: string; value: string}) {
  return (
    <div className="min-w-0 py-row first:pt-0 last:pb-0">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Text size="sm" className="break-words">
        {value}
      </Text>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
