import {QueryLoadError} from '@shipfox/client-ui';
import {IntegrationIcon} from '@shipfox/integration-icons';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Panel, PanelBody, PanelCell, PanelCellAction, PanelGrid} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import type {IntegrationProvider} from '#core/models.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

export interface ProviderGridProps {
  workspaceSlug: string;
  providers: IntegrationProvider[];
  isPending: boolean;
  isFetching?: boolean;
  error?: Error | null | undefined;
  onRetry?: () => void;
  emptyMessage: string;
  loadingLabel?: string;
  errorSubject?: string;
  onOpenProvider?: ((provider: string) => void) | undefined;
}

export function ProviderGrid({
  workspaceSlug,
  providers,
  isPending,
  isFetching = false,
  error,
  onRetry,
  emptyMessage,
  loadingLabel = 'Loading providers',
  errorSubject = 'available integrations',
  onOpenProvider,
}: ProviderGridProps) {
  const installableProviders = providers.filter((provider) => PROVIDER_CATALOG[provider.provider]);

  if (isPending) return <ProviderGridSkeleton label={loadingLabel} />;

  if (error) {
    return (
      <Panel>
        <QueryLoadError
          query={{
            isError: true,
            isFetching,
            data: undefined,
            error,
            refetch: onRetry ?? (() => undefined),
          }}
          subject={errorSubject}
          variant="panel"
        />
      </Panel>
    );
  }

  if (installableProviders.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="componentLine"
          title="No integrations available"
          description={emptyMessage}
          variant="panel"
        />
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelBody>
        <PanelGrid aria-label="Available integrations">
          {installableProviders.map((provider) => (
            <ProviderCell
              key={provider.provider}
              provider={provider}
              workspaceSlug={workspaceSlug}
              onOpenProvider={onOpenProvider}
            />
          ))}
        </PanelGrid>
      </PanelBody>
    </Panel>
  );
}

function ProviderCell({
  provider,
  workspaceSlug,
  onOpenProvider,
}: {
  provider: IntegrationProvider;
  workspaceSlug: string;
  onOpenProvider?: ((provider: string) => void) | undefined;
}) {
  const catalog = PROVIDER_CATALOG[provider.provider];
  if (!catalog) return null;

  if (catalog.kind === 'modal-connect') {
    return (
      <PanelCell>
        <PanelCellAction
          action="Add"
          aria-label={`Add ${provider.displayName}`}
          onClick={() => onOpenProvider?.(provider.provider)}
        >
          <ProviderCellContent provider={provider} />
        </PanelCellAction>
      </PanelCell>
    );
  }

  return (
    <PanelCell>
      <PanelCellAction asChild action="Install">
        <Link
          to={catalog.setupPath}
          params={{workspaceSlug}}
          aria-label={`Install ${provider.displayName}`}
        >
          <ProviderCellContent provider={provider} />
        </Link>
      </PanelCellAction>
    </PanelCell>
  );
}

function ProviderCellContent({provider}: {provider: IntegrationProvider}) {
  return (
    <span className="flex min-w-0 items-center gap-cluster">
      <IntegrationIcon
        source={provider.provider}
        aria-hidden
        className="size-24 shrink-0 text-foreground-neutral-base"
      />
      <Text as="span" size="md" bold className="truncate">
        {provider.displayName}
      </Text>
    </span>
  );
}

function ProviderGridSkeleton({label}: {label: string}) {
  return (
    <Panel>
      <PanelBody>
        <PanelGrid role="status" aria-label={label}>
          {[0, 1, 2, 3].map((tile) => (
            <PanelCell key={tile}>
              <div className="flex items-center justify-between gap-cluster px-row py-row">
                <div className="flex min-w-0 items-center gap-cluster">
                  <Skeleton className="size-24 shrink-0" />
                  <Skeleton className="h-16 w-100" />
                </div>
                <Skeleton className="h-16 w-64 shrink-0" />
              </div>
            </PanelCell>
          ))}
        </PanelGrid>
      </PanelBody>
    </Panel>
  );
}
