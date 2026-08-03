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

const INSTALLED_SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

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
    <section className="flex flex-col gap-16" aria-label="Installed integrations">
      <div className="flex flex-col gap-4">
        <Header variant="h3">Installed integrations</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Provider accounts installed in this workspace.
        </Text>
      </div>

      {isPending ? <InstalledSkeleton label="Loading integrations" /> : null}

      {error ? (
        <div className={cn(INSTALLED_SURFACE_CLASS, 'px-16')}>
          <QueryLoadError
            query={{isError: true, isFetching, data: undefined, error, refetch: onRetry}}
            subject="integrations"
          />
        </div>
      ) : null}

      {!isPending && !error && connections.length === 0 ? (
        <div className={cn(INSTALLED_SURFACE_CLASS, 'px-16')}>
          <EmptyState
            icon="componentLine"
            title="No integrations installed yet"
            description="Install a provider below to get started."
          />
        </div>
      ) : null}

      {connections.length > 0 ? (
        <ul className={cn('divide-y divide-border-neutral-base', INSTALLED_SURFACE_CLASS)}>
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
    <li className="flex items-center gap-12 px-16 py-12 transition-colors hover:bg-background-components-hover">
      <IntegrationIcon
        source={connection.provider}
        aria-hidden
        className={cn(
          'size-24 shrink-0',
          muted ? 'text-foreground-neutral-disabled' : 'text-foreground-neutral-base',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-8">
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
  );
}

function InstalledSkeleton({label}: {label: string}) {
  return (
    <ul
      role="status"
      aria-label={label}
      className={cn('divide-y divide-border-neutral-base', INSTALLED_SURFACE_CLASS)}
    >
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-12 px-16 py-12">
          <Skeleton className="size-24 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-16 w-120" />
            <Skeleton className="h-12 w-80" />
          </div>
          <Skeleton className="h-20 w-72 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
