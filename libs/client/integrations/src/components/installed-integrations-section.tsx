import {QueryLoadError} from '@shipfox/client-ui';
import {IntegrationIcon} from '@shipfox/integration-icons';
import {IconButton} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Panel, PanelBody, PanelRow} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Header, Text} from '@shipfox/react-ui/typography';
import {cn, formatDate} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {ConnectionStatusBadge} from '#connection-status-badge.js';
import {type IntegrationConnection, isUsableConnection} from '#core/models.js';
import {usageEventsForConnection} from './integration-usage-events.js';

interface InstalledIntegrationsSectionProps {
  workspaceSlug?: string | undefined;
  connections: IntegrationConnection[];
  isPending: boolean;
  isFetching: boolean;
  error?: Error | null | undefined;
  onRetry: () => void;
  isMutating: boolean;
  onUse: (connectionId: string) => void;
  onSetActive: (connection: IntegrationConnection, active: boolean) => void;
  onDelete: (connectionId: string) => void;
  providerDisplayName: (provider: string) => string | undefined;
}

export function InstalledIntegrationsSection({
  workspaceSlug,
  connections,
  isPending,
  isFetching,
  error,
  onRetry,
  isMutating,
  onUse,
  onSetActive,
  onDelete,
  providerDisplayName,
}: InstalledIntegrationsSectionProps) {
  return (
    <section className="flex flex-col gap-group" aria-label="Installed integrations">
      <div className="flex flex-col gap-tight">
        <Header variant="h3">Installed integrations</Header>
      </div>

      {isPending ? <InstalledSkeleton label="Loading integrations" /> : null}

      {error ? (
        <Panel>
          <QueryLoadError
            query={{isError: true, isFetching, data: undefined, error, refetch: onRetry}}
            subject="integrations"
            variant="panel"
          />
        </Panel>
      ) : null}

      {!isPending && !error && connections.length === 0 ? (
        <Panel>
          <EmptyState
            icon="componentLine"
            title="No integrations installed yet"
            description="Install a provider below to get started."
            variant="panel"
          />
        </Panel>
      ) : null}

      {connections.length > 0 ? (
        <Panel>
          <PanelBody asChild>
            <ul>
              {connections.map((connection) => (
                <InstalledRow
                  key={connection.id}
                  connection={connection}
                  workspaceSlug={workspaceSlug}
                  isMutating={isMutating}
                  onUse={onUse}
                  onSetActive={(nextActive) => onSetActive(connection, nextActive)}
                  onDelete={onDelete}
                  providerDisplayName={providerDisplayName}
                />
              ))}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}
    </section>
  );
}

function InstalledRow({
  connection,
  workspaceSlug,
  isMutating,
  onUse,
  onSetActive,
  onDelete,
  providerDisplayName,
}: {
  connection: IntegrationConnection;
  workspaceSlug?: string | undefined;
  isMutating: boolean;
  onUse: (connectionId: string) => void;
  onSetActive: (active: boolean) => void;
  onDelete: (connectionId: string) => void;
  providerDisplayName: (provider: string) => string | undefined;
}) {
  const muted = connection.lifecycleStatus === 'disabled';
  const active = isUsableConnection(connection);
  const recentEventsEvent = usageEventsForConnection(connection)[0]?.value ?? 'received';
  const providerName = providerDisplayName(connection.provider);

  return (
    <PanelRow asChild className="justify-start gap-cluster">
      <li>
        <IntegrationIcon
          source={connection.provider}
          aria-hidden
          className={cn(
            'size-24 shrink-0',
            muted ? 'text-foreground-neutral-disabled' : 'text-foreground-neutral-base',
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-tight">
          <div className="flex min-w-0 items-center gap-inline">
            <Text
              size="md"
              bold
              className={cn('truncate', muted ? 'text-foreground-neutral-disabled' : undefined)}
            >
              {connection.displayName}
            </Text>
            <ConnectionStatusBadge status={connection.lifecycleStatus} className="shrink-0" />
          </div>
          <Text size="sm" className="truncate text-foreground-neutral-muted">
            Added {formatDate(connection.createdAt)}
          </Text>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Open ${connection.displayName} integration actions`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {connection.externalUrl ? (
              <DropdownMenuItem asChild>
                <a href={connection.externalUrl} target="_blank" rel="noreferrer noopener">
                  {providerName ? `Open in ${providerName}` : 'Open provider settings'}
                </a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => onUse(connection.id)}>
              Use this integration
            </DropdownMenuItem>
            {workspaceSlug ? (
              <DropdownMenuItem asChild>
                <Link
                  to="/w/$workspaceSlug/settings/events"
                  params={{workspaceSlug}}
                  search={{source: [connection.slug], event: [recentEventsEvent]}}
                >
                  View recent events
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isMutating} onSelect={() => onSetActive(!active)}>
              {active ? 'Disable integration' : 'Enable integration'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isMutating} onSelect={() => onDelete(connection.id)}>
              Delete integration
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    </PanelRow>
  );
}

function InstalledSkeleton({label}: {label: string}) {
  return (
    <Panel>
      <PanelBody asChild>
        <ul role="status" aria-label={label}>
          {[0, 1, 2].map((row) => (
            <PanelRow
              asChild
              className="justify-start gap-cluster hover:bg-background-neutral-base"
              key={row}
            >
              <li>
                <Skeleton className="size-24 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-tight">
                  <Skeleton className="h-16 w-120" />
                  <Skeleton className="h-12 w-80" />
                </div>
                <Skeleton className="h-20 w-72 shrink-0" />
              </li>
            </PanelRow>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
