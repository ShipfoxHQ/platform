import {QueryLoadError} from '@shipfox/client-ui';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Card} from '@shipfox/react-ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Header, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {
  type ManagementModal,
  managementModalReducer,
} from '#core/model-provider-management-reducer.js';
import type {
  BuiltinProviderConfig,
  CustomProviderConfig,
  ProviderCatalogEntry,
  ProviderConfig,
  SupportedProvider,
} from '#core/models.js';
import {
  customProviderCardMatchesSearch,
  isSupportedProvider,
  availableProviders as selectAvailableProviders,
} from '#core/provider-policy.js';
import {
  useDeleteModelProviderConfigMutation,
  useModelProviderCatalogQuery,
  useModelProviderConfigsQuery,
  useSetDefaultModelProviderMutation,
} from '#hooks/api/model-providers.js';
import {AddCustomProviderCard} from './add-custom-provider-card.js';
import {AvailableProvidersGrid, PROVIDER_GRID_CLASS} from './available-providers-grid.js';
import {ChangeDefaultModelForm} from './change-default-model-form.js';
import {CustomModelProviderForm} from './custom-model-provider-form.js';
import {modelProviderConfigErrorToFormError} from './form-errors.js';
import {ModelProviderUsageModal} from './model-provider-usage-modal.js';
import {
  type ModelProviderUsageTarget,
  usageTargetFromCatalogEntry,
  usageTargetFromCustomConfig,
} from './model-provider-usage-target.js';
import {ModelProviderTestAndSaveForm} from './test-and-save-form.js';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

type UsageTarget = {
  target: ModelProviderUsageTarget;
  initialModel: string | null;
  restoreFocusToConfiguredProviders: boolean;
};

const USAGE_MODAL_OPEN_DELAY_MS = 250;

export function WorkspaceModelProvidersSection({workspaceId}: {workspaceId: string}) {
  const catalogQuery = useModelProviderCatalogQuery();
  const configsQuery = useModelProviderConfigsQuery(workspaceId);
  const [modal, dispatchModal] = useReducer(managementModalReducer, {kind: 'closed'});
  const [pendingUsageTarget, setPendingUsageTarget] = useState<UsageTarget | null>(null);
  const configuredProvidersRegionRef = useRef<HTMLElement | null>(null);

  const providers = catalogQuery.data?.providers ?? [];
  const configs = configsQuery.data?.configs ?? [];
  const configsLoaded = configsQuery.data !== undefined;
  const defaultProviderId = configsQuery.data?.defaultProviderId ?? null;
  const providerById = useMemo(
    () =>
      new Map<string, ProviderCatalogEntry>(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const availableProviders = configsLoaded ? selectAvailableProviders(providers, configs) : [];
  const unsupportedProviders = providers.filter((provider) => !isSupportedProvider(provider));

  useEffect(() => {
    if (pendingUsageTarget === null || modal.kind !== 'closed') return undefined;

    const timer = window.setTimeout(() => {
      dispatchModal({
        type: 'show-usage',
        providerId: pendingUsageTarget.target.id,
        initialModel: pendingUsageTarget.initialModel,
        restoreFocusToConfiguredProviders: pendingUsageTarget.restoreFocusToConfiguredProviders,
      });
      setPendingUsageTarget(null);
    }, USAGE_MODAL_OPEN_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [modal.kind, pendingUsageTarget]);

  const usageTarget = useMemo(() => {
    if (modal.kind !== 'show-usage') return null;
    const config = configs.find((item) => item.providerId === modal.providerId);
    if (config?.kind === 'custom') return usageTargetFromCustomConfig(config);
    const entry = providerById.get(modal.providerId);
    return entry && isSupportedProvider(entry) ? usageTargetFromCatalogEntry(entry) : null;
  }, [configs, modal, providerById]);

  return (
    <div className="flex min-w-0 flex-col gap-region">
      <section
        ref={configuredProvidersRegionRef}
        className="flex flex-col gap-group outline-none"
        aria-label="Configured providers"
        tabIndex={-1}
      >
        <div className="flex flex-col gap-tight">
          <Header variant="h3">Configured providers</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Workspace credentials available to agent steps.
          </Text>
        </div>

        {configsQuery.isPending ? (
          <ModelProviderRowsSkeleton label="Loading configured providers" />
        ) : null}

        {configsQuery.isError && configsQuery.data === undefined ? (
          <div className={SURFACE_CLASS}>
            <QueryLoadError query={configsQuery} subject="model provider configs" variant="panel" />
          </div>
        ) : null}

        {configsQuery.data !== undefined && configs.length === 0 ? (
          <div className={SURFACE_CLASS}>
            <EmptyState
              icon="key2Line"
              title="No providers configured"
              description="Configure a provider below to run agent steps with workspace-managed credentials."
              variant="panel"
            />
          </div>
        ) : null}

        {configs.length > 0 ? (
          <ul className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}>
            {configs.map((config) => {
              const catalogEntry = providerById.get(config.providerId);
              const entry =
                catalogEntry && isSupportedProvider(catalogEntry) ? catalogEntry : undefined;
              const builtinConfig = isBuiltinModelProviderConfig(config) ? config : undefined;
              const customConfig = isCustomModelProviderConfig(config) ? config : undefined;
              return (
                <ConfiguredProviderRow
                  key={config.providerId}
                  workspaceId={workspaceId}
                  config={config}
                  entry={entry}
                  isDefault={config.providerId === defaultProviderId}
                  onEdit={() => {
                    if (entry && builtinConfig) {
                      dispatchModal({type: 'edit-builtin', provider: entry, config: builtinConfig});
                    } else if (customConfig) {
                      dispatchModal({type: 'edit-custom', config: customConfig});
                    }
                  }}
                  onChangeDefaultModel={() => {
                    if (entry && builtinConfig)
                      dispatchModal({
                        type: 'change-default-model',
                        provider: entry,
                        config: builtinConfig,
                      });
                  }}
                  onShowUsage={() => {
                    if (entry && builtinConfig) {
                      setPendingUsageTarget(null);
                      dispatchModal({
                        type: 'show-usage',
                        providerId: entry.id,
                        initialModel: builtinConfig.defaultModel,
                        restoreFocusToConfiguredProviders: false,
                      });
                    } else if (customConfig) {
                      setPendingUsageTarget(null);
                      dispatchModal({
                        type: 'show-usage',
                        providerId: customConfig.providerId,
                        initialModel: customConfig.defaultModel,
                        restoreFocusToConfiguredProviders: false,
                      });
                    }
                  }}
                />
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-group" aria-label="Available providers">
        <div className="flex flex-col gap-tight">
          <Header variant="h3">Available providers</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Providers that can be configured for agent steps in this workspace.
          </Text>
        </div>

        {catalogQuery.isPending || configsQuery.isPending ? <ModelProviderGridSkeleton /> : null}

        {catalogQuery.isError && catalogQuery.data === undefined ? (
          <div className={SURFACE_CLASS}>
            <QueryLoadError query={catalogQuery} subject="model provider catalog" variant="panel" />
          </div>
        ) : null}

        {configsLoaded ? (
          <AvailableProvidersGrid
            entries={availableProviders}
            onSelect={(entry) => dispatchModal({type: 'configure-builtin', provider: entry})}
            trailingCard={
              <AddCustomProviderCard onConfigure={() => dispatchModal({type: 'create-custom'})} />
            }
            trailingCardMatchesSearch={customProviderCardMatchesSearch}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-group" aria-label="Unsupported providers">
        <div className="flex flex-col gap-tight">
          <Header variant="h3">Unsupported providers</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Providers that cannot be configured in this workspace yet.
          </Text>
        </div>

        {catalogQuery.isPending ? (
          <ModelProviderRowsSkeleton label="Loading unsupported providers" />
        ) : null}

        {unsupportedProviders.length > 0 ? (
          <ul className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}>
            {unsupportedProviders.map((entry) => (
              <li key={entry.id} className="flex items-start gap-cluster px-row py-row opacity-70">
                <Icon
                  name="forbid2Line"
                  className="mt-[2px] size-18 shrink-0 text-foreground-neutral-muted"
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-tight">
                  <Text size="md" bold className="truncate">
                    {entry.label}
                  </Text>
                  <Text size="sm" className="text-foreground-neutral-muted">
                    {entry.unsupportedReason}
                  </Text>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Modal
        open={modal.kind === 'configure-builtin' || modal.kind === 'edit-builtin'}
        onOpenChange={(open) => (open ? undefined : dispatchModal({type: 'close'}))}
      >
        <ModalContent aria-describedby={undefined}>
          <ModalTitle className="sr-only">{modelProviderFormTitle(modal)}</ModalTitle>
          <ModalHeader>
            <Text
              size="lg"
              aria-hidden="true"
              className="overflow-ellipsis overflow-hidden whitespace-nowrap"
            >
              {modelProviderFormTitle(modal)}
            </Text>
          </ModalHeader>
          {modal.kind === 'configure-builtin' || modal.kind === 'edit-builtin' ? (
            <ModelProviderTestAndSaveForm
              workspaceId={workspaceId}
              entry={modal.provider}
              existingConfig={modal.kind === 'edit-builtin' ? modal.config : undefined}
              onSaved={(savedDefaultModel) => {
                toast.success(`${modal.provider.label} saved`);
                if (modal.kind === 'configure-builtin' && configs.length === 0) {
                  setPendingUsageTarget({
                    target: usageTargetFromCatalogEntry(modal.provider),
                    initialModel: savedDefaultModel,
                    restoreFocusToConfiguredProviders: true,
                  });
                }
                dispatchModal({type: 'close'});
              }}
            />
          ) : null}
        </ModalContent>
      </Modal>

      <Modal
        open={modal.kind === 'change-default-model'}
        onOpenChange={(open) => (open ? undefined : dispatchModal({type: 'close'}))}
      >
        <ModalContent aria-describedby={undefined}>
          <ModalTitle className="sr-only">Change default model</ModalTitle>
          <ModalHeader>
            <Text
              size="lg"
              aria-hidden="true"
              className="overflow-ellipsis overflow-hidden whitespace-nowrap"
            >
              Change default model for{' '}
              {modal.kind === 'change-default-model' ? modal.provider.label : ''}
            </Text>
          </ModalHeader>
          {modal.kind === 'change-default-model' ? (
            <ChangeDefaultModelForm
              workspaceId={workspaceId}
              entry={modal.provider}
              config={modal.config}
              onSaved={() => {
                toast.success(`${modal.provider.label} default model saved`);
                dispatchModal({type: 'close'});
              }}
            />
          ) : null}
        </ModalContent>
      </Modal>

      <ModelProviderUsageModal
        target={usageTarget}
        initialModel={modal.kind === 'show-usage' ? modal.initialModel : null}
        workspaceDefaultHarnessId={configsQuery.data?.defaultHarnessId ?? null}
        open={modal.kind === 'show-usage'}
        closeFocusTarget={
          modal.kind === 'show-usage' && modal.restoreFocusToConfiguredProviders
            ? configuredProvidersRegionRef.current
            : null
        }
        onOpenChange={(open) => {
          if (!open) dispatchModal({type: 'close'});
        }}
      />

      <Modal
        open={modal.kind === 'create-custom' || modal.kind === 'edit-custom'}
        onOpenChange={(open) => (open ? undefined : dispatchModal({type: 'close'}))}
      >
        <ModalContent
          aria-describedby={undefined}
          className="max-h-[calc(100vh-32px)] max-w-[760px]"
        >
          <ModalTitle className="sr-only">{customModelProviderFormTitle(modal)}</ModalTitle>
          <ModalHeader>
            <div className="flex min-w-0 flex-col gap-tight">
              <Text size="lg" aria-hidden="true" className="truncate">
                {customModelProviderFormTitle(modal)}
              </Text>
              <Text size="sm" className="text-foreground-neutral-muted">
                Connect an OpenAI-, Anthropic-, or Gemini-compatible endpoint.
              </Text>
            </div>
          </ModalHeader>
          {modal.kind === 'create-custom' || modal.kind === 'edit-custom' ? (
            <CustomModelProviderForm
              workspaceId={workspaceId}
              existingConfig={modal.kind === 'edit-custom' ? modal.config : undefined}
              onSaved={() => {
                toast.success(
                  modal.kind === 'edit-custom'
                    ? `${modal.config.displayName} saved`
                    : 'Custom provider saved',
                );
                dispatchModal({type: 'close'});
              }}
            />
          ) : null}
        </ModalContent>
      </Modal>
    </div>
  );
}

function modelProviderFormTitle(modal: ManagementModal): string {
  if (modal.kind === 'edit-builtin') return `Edit credentials for ${modal.provider.label}`;
  if (modal.kind === 'configure-builtin') return `Configure ${modal.provider.label}`;
  return '';
}

function customModelProviderFormTitle(modal: ManagementModal): string {
  if (modal.kind === 'edit-custom') return `Edit ${modal.config.displayName}`;
  return 'Add custom provider';
}

function isBuiltinModelProviderConfig(config: ProviderConfig): config is BuiltinProviderConfig {
  return config.kind === 'builtin';
}

function isCustomModelProviderConfig(config: ProviderConfig): config is CustomProviderConfig {
  return config.kind === 'custom';
}

function ConfiguredProviderRow({
  workspaceId,
  config,
  entry,
  isDefault,
  onEdit,
  onChangeDefaultModel,
  onShowUsage,
}: {
  workspaceId: string;
  config: ProviderConfig;
  entry: SupportedProvider | undefined;
  isDefault: boolean;
  onEdit: () => void;
  onChangeDefaultModel: () => void;
  onShowUsage: () => void;
}) {
  const setDefault = useSetDefaultModelProviderMutation();
  const deleteConfig = useDeleteModelProviderConfigMutation();
  const [defaultError, setDefaultError] = useState<string | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const customConfig = isCustomModelProviderConfig(config) ? config : undefined;
  const label = customConfig?.displayName ?? entry?.label ?? config.providerId;
  const canUse = entry !== undefined || customConfig !== undefined;
  const canEdit = entry !== undefined || customConfig !== undefined;
  const isBuiltinConfig = isBuiltinModelProviderConfig(config);

  async function handleSetDefault() {
    setDefaultError(undefined);
    try {
      await setDefault.mutateAsync({
        workspaceId,
        providerId: config.providerId,
      });
      toast.success(`${label} is now the default provider`);
    } catch (error) {
      const mapped = modelProviderConfigErrorToFormError(error);
      setDefaultError(mapped.message);
    }
  }

  async function handleDelete() {
    setDeleteError(undefined);
    try {
      await deleteConfig.mutateAsync({workspaceId, providerId: config.providerId});
      toast.success(`${label} deleted`);
      setDeleteOpen(false);
    } catch (error) {
      const mapped = modelProviderConfigErrorToFormError(error);
      setDeleteError(mapped.message);
    }
  }

  function handleDeleteOpenChange(nextOpen: boolean) {
    setDeleteOpen(nextOpen);
    if (nextOpen) {
      setDeleteError(undefined);
      deleteConfig.reset();
    }
  }

  return (
    <li className="flex flex-col gap-inline px-row py-row transition-colors hover:bg-background-components-hover">
      <div className="flex items-center justify-between gap-cluster">
        <div className="flex min-w-0 items-center gap-inline">
          {isDefault ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex size-16 shrink-0 items-center justify-center">
                    <Icon
                      name="starLine"
                      className="size-16 text-foreground-neutral-muted"
                      aria-hidden
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Default provider</TooltipContent>
              </Tooltip>
              <span className="sr-only">Default provider</span>
            </>
          ) : null}
          <Text size="md" bold className="truncate">
            {label}
          </Text>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Open ${label} provider actions`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isDefault ? (
              <DropdownMenuItem
                icon="starLine"
                disabled={setDefault.isPending || (!entry && !customConfig)}
                onSelect={() => {
                  void handleSetDefault();
                }}
              >
                Set as default
              </DropdownMenuItem>
            ) : null}
            {isBuiltinConfig ? (
              <DropdownMenuItem
                icon="settings3Line"
                disabled={!entry}
                onSelect={onChangeDefaultModel}
              >
                Change default model
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem icon="bookOpenLine" disabled={!canUse} onSelect={onShowUsage}>
              View workflow example
            </DropdownMenuItem>
            <DropdownMenuItem icon="editLine" disabled={!canEdit} onSelect={onEdit}>
              {customConfig ? 'Edit' : 'Edit credentials'}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon="deleteBinLine"
              onSelect={() => {
                setDeleteOpen(true);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {defaultError ? (
        <Callout role="alert" type="error">
          <Text size="sm">{defaultError}</Text>
        </Callout>
      ) : null}
      <DeleteModelProviderDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        label={label}
        errorMessage={deleteError}
        isLoading={deleteConfig.isPending}
        onDelete={handleDelete}
      />
    </li>
  );
}

function DeleteModelProviderDialog({
  open,
  onOpenChange,
  label,
  errorMessage,
  isLoading,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  errorMessage: string | undefined;
  isLoading: boolean;
  onDelete: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent aria-describedby={undefined} className="max-w-[420px]">
        <ModalTitle className="sr-only">Delete model provider</ModalTitle>
        <ModalHeader title="Delete model provider" />
        <ModalBody className="gap-group">
          <Text size="sm" className="text-foreground-neutral-muted">
            Delete {label} credentials from this workspace? Agent jobs cannot use this provider
            until it is configured again.
          </Text>
          {errorMessage ? (
            <Callout role="alert" type="error">
              <Text size="sm">{errorMessage}</Text>
            </Callout>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" isLoading={isLoading} onClick={onDelete}>
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ModelProviderRowsSkeleton({label}: {label: string}) {
  return (
    <ul
      role="status"
      aria-label={label}
      className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}
    >
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-cluster px-row py-row">
          <Skeleton className="size-32 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-inline">
            <Skeleton className="h-16 w-120" />
            <Skeleton className="h-14 w-180" />
          </div>
          <Skeleton className="h-28 w-96 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

function ModelProviderGridSkeleton() {
  return (
    <div role="status" aria-label="Loading available providers" className={PROVIDER_GRID_CLASS}>
      {[0, 1, 2, 3].map((card) => (
        <Card key={card} className="h-136 w-full justify-center p-panel-compact">
          <div className="flex items-center justify-between gap-cluster">
            <Skeleton className="h-16 w-100" />
            <Skeleton className="h-16 w-64 shrink-0" />
          </div>
        </Card>
      ))}
    </div>
  );
}
