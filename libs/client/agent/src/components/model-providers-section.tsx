import {QueryLoadError} from '@shipfox/client-ui';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
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
import {Panel, PanelBody, PanelRow} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
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
  UnsupportedProvider,
} from '#core/models.js';
import {
  customProviderCardMatchesSearch,
  isManagedOnlyCatalog,
  isSupportedProvider,
  managedProviderFromCatalog,
  availableProviders as selectAvailableProviders,
} from '#core/provider-policy.js';
import {
  useDeleteModelProviderConfigMutation,
  useModelProviderCatalogQuery,
  useModelProviderConfigsQuery,
  useSetDefaultModelProviderMutation,
} from '#hooks/api/model-providers.js';
import {AddCustomProviderCard} from './add-custom-provider-card.js';
import {AvailableProvidersGrid} from './available-providers-grid.js';
import {ChangeDefaultModelForm} from './change-default-model-form.js';
import {CustomModelProviderForm} from './custom-model-provider-form.js';
import {modelProviderConfigErrorToFormError} from './form-errors.js';
import {ModelProviderGridSkeleton} from './model-provider-grid-skeleton.js';
import {ModelProviderUsageModal} from './model-provider-usage-modal.js';
import {
  type ModelProviderUsageTarget,
  usageTargetFromCatalogEntry,
  usageTargetFromCustomConfig,
} from './model-provider-usage-target.js';
import {ModelProviderTestAndSaveForm} from './test-and-save-form.js';

type UsageTarget = {
  target: ModelProviderUsageTarget;
  initialModel: string | null;
  restoreFocusToConfiguredProviders: boolean;
};

const USAGE_MODAL_OPEN_DELAY_MS = 250;
type ManagementModalDispatch = Dispatch<Parameters<typeof managementModalReducer>[1]>;
type SetPendingUsageTarget = Dispatch<SetStateAction<UsageTarget | null>>;

function ManagedProviderSection({
  provider,
  onShowUsage,
}: {
  provider: SupportedProvider | undefined;
  onShowUsage: () => void;
}) {
  return (
    <section className="flex flex-col gap-group" aria-label="Managed provider">
      <div className="flex flex-col gap-tight">
        <Header variant="h3">Managed provider</Header>
      </div>

      {provider ? (
        <Panel>
          <PanelBody className="gap-group p-panel">
            <div className="flex min-w-0 flex-col gap-tight">
              <Text size="md" bold>
                {provider.label}
              </Text>
              <Text size="sm" className="text-foreground-neutral-muted">
                Managed by this instance. No workspace credentials are required.
              </Text>
            </div>

            <div className="flex flex-col gap-inline">
              <Text size="sm" bold>
                Available models ({provider.models.length})
              </Text>
              <ul
                aria-label={`${provider.label} models`}
                className="rounded-8 border border-border-neutral-base"
              >
                {provider.models.map((model) => (
                  <li
                    key={model.id}
                    className="flex min-w-0 items-center justify-between gap-inline border-b border-border-neutral-base px-row py-row last:border-b-0"
                  >
                    <Text as="span" size="sm" bold className="min-w-0 truncate">
                      {model.label}
                    </Text>
                    <Code
                      as="span"
                      variant="label"
                      className="min-w-0 truncate text-foreground-neutral-muted"
                    >
                      {model.id}
                    </Code>
                  </li>
                ))}
              </ul>
            </div>

            <Button type="button" size="sm" variant="secondary" onClick={onShowUsage}>
              Use in a workflow
            </Button>
          </PanelBody>
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            icon="errorWarningLine"
            title="Managed provider unavailable"
            description="This instance is configured without workspace providers, but no managed provider was returned."
            variant="panel"
          />
        </Panel>
      )}
    </section>
  );
}

function ConfiguredProvidersSection({
  workspaceId,
  regionRef,
  query,
  configs,
  providerById,
  defaultProviderId,
  dispatchModal,
  setPendingUsageTarget,
}: {
  workspaceId: string;
  regionRef: RefObject<HTMLElement | null>;
  query: ReturnType<typeof useModelProviderConfigsQuery>;
  configs: readonly ProviderConfig[];
  providerById: ReadonlyMap<string, ProviderCatalogEntry>;
  defaultProviderId: string | null;
  dispatchModal: ManagementModalDispatch;
  setPendingUsageTarget: SetPendingUsageTarget;
}) {
  return (
    <section
      ref={regionRef}
      className="flex flex-col gap-group outline-none"
      aria-label="Configured providers"
      tabIndex={-1}
    >
      <div className="flex flex-col gap-tight">
        <Header variant="h3">Configured providers</Header>
      </div>
      {query.isPending ? <ModelProviderRowsSkeleton label="Loading configured providers" /> : null}
      {query.isError && query.data === undefined ? (
        <Panel>
          <QueryLoadError query={query} subject="model provider configs" variant="panel" />
        </Panel>
      ) : null}
      {query.data !== undefined && configs.length === 0 ? (
        <Panel>
          <EmptyState
            icon="key2Line"
            title="No providers configured"
            description="Configure a provider below to run agent steps with workspace-managed credentials."
            variant="panel"
          />
        </Panel>
      ) : null}
      {configs.length > 0 ? (
        <Panel>
          <PanelBody asChild>
            <ul>
              {configs.map((config) => (
                <ConfiguredProviderRowController
                  key={config.providerId}
                  workspaceId={workspaceId}
                  config={config}
                  catalogEntry={providerById.get(config.providerId)}
                  isDefault={config.providerId === defaultProviderId}
                  dispatchModal={dispatchModal}
                  setPendingUsageTarget={setPendingUsageTarget}
                />
              ))}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}
    </section>
  );
}

function ConfiguredProviderRowController({
  workspaceId,
  config,
  catalogEntry,
  isDefault,
  dispatchModal,
  setPendingUsageTarget,
}: {
  workspaceId: string;
  config: ProviderConfig;
  catalogEntry: ProviderCatalogEntry | undefined;
  isDefault: boolean;
  dispatchModal: ManagementModalDispatch;
  setPendingUsageTarget: SetPendingUsageTarget;
}) {
  const entry = catalogEntry && isSupportedProvider(catalogEntry) ? catalogEntry : undefined;
  const builtinConfig = isBuiltinModelProviderConfig(config) ? config : undefined;
  const customConfig = isCustomModelProviderConfig(config) ? config : undefined;

  function editProvider() {
    if (entry && builtinConfig) {
      dispatchModal({type: 'edit-builtin', provider: entry, config: builtinConfig});
    } else if (customConfig) {
      dispatchModal({type: 'edit-custom', config: customConfig});
    }
  }

  function changeDefaultModel() {
    if (!entry || !builtinConfig) return;
    dispatchModal({type: 'change-default-model', provider: entry, config: builtinConfig});
  }

  function showUsage() {
    setPendingUsageTarget(null);
    if (entry && builtinConfig) {
      dispatchModal({
        type: 'show-usage',
        providerId: entry.id,
        initialModel: builtinConfig.defaultModel,
        restoreFocusToConfiguredProviders: false,
      });
    } else if (customConfig) {
      dispatchModal({
        type: 'show-usage',
        providerId: customConfig.providerId,
        initialModel: customConfig.defaultModel,
        restoreFocusToConfiguredProviders: false,
      });
    }
  }

  return (
    <ConfiguredProviderRow
      workspaceId={workspaceId}
      config={config}
      entry={entry}
      isDefault={isDefault}
      onEdit={editProvider}
      onChangeDefaultModel={changeDefaultModel}
      onShowUsage={showUsage}
    />
  );
}

function AvailableProvidersSection({
  catalogQuery,
  configsPending,
  configsLoaded,
  providers,
  dispatchModal,
}: {
  catalogQuery: ReturnType<typeof useModelProviderCatalogQuery>;
  configsPending: boolean;
  configsLoaded: boolean;
  providers: SupportedProvider[];
  dispatchModal: ManagementModalDispatch;
}) {
  return (
    <section className="flex flex-col gap-group" aria-label="Available providers">
      <div className="flex flex-col gap-tight">
        <Header variant="h3">Available providers</Header>
      </div>
      {catalogQuery.isPending || configsPending ? (
        <ModelProviderGridSkeleton label="Loading available providers" />
      ) : null}
      {catalogQuery.isError && catalogQuery.data === undefined ? (
        <Panel>
          <QueryLoadError query={catalogQuery} subject="model provider catalog" variant="panel" />
        </Panel>
      ) : null}
      {configsLoaded ? (
        <AvailableProvidersGrid
          entries={providers}
          onSelect={(provider) => dispatchModal({type: 'configure-builtin', provider})}
          trailingCard={
            <AddCustomProviderCard onConfigure={() => dispatchModal({type: 'create-custom'})} />
          }
          trailingCardMatchesSearch={customProviderCardMatchesSearch}
        />
      ) : null}
    </section>
  );
}

function UnsupportedProvidersSection({
  loading,
  providers,
}: {
  loading: boolean;
  providers: readonly UnsupportedProvider[];
}) {
  return (
    <section className="flex flex-col gap-group" aria-label="Unsupported providers">
      <div className="flex flex-col gap-tight">
        <Header variant="h3">Unsupported providers</Header>
      </div>
      {loading ? <ModelProviderRowsSkeleton label="Loading unsupported providers" /> : null}
      {providers.length > 0 ? (
        <Panel>
          <PanelBody asChild>
            <ul>
              {providers.map((entry) => (
                <PanelRow
                  asChild
                  className="items-start justify-start gap-cluster opacity-70 hover:bg-background-neutral-base"
                  key={entry.id}
                >
                  <li>
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
                </PanelRow>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}
    </section>
  );
}

function BuiltinProviderModal({
  workspaceId,
  modal,
  configuredCount,
  dispatchModal,
  setPendingUsageTarget,
}: {
  workspaceId: string;
  modal: ManagementModal;
  configuredCount: number;
  dispatchModal: ManagementModalDispatch;
  setPendingUsageTarget: SetPendingUsageTarget;
}) {
  const builtin =
    modal.kind === 'configure-builtin' || modal.kind === 'edit-builtin' ? modal : null;
  return (
    <Modal
      open={builtin !== null}
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
        {builtin ? (
          <ModelProviderTestAndSaveForm
            workspaceId={workspaceId}
            entry={builtin.provider}
            existingConfig={builtin.kind === 'edit-builtin' ? builtin.config : undefined}
            onSaved={(savedDefaultModel) => {
              toast.success(`${builtin.provider.label} saved`);
              if (builtin.kind === 'configure-builtin' && configuredCount === 0) {
                setPendingUsageTarget({
                  target: usageTargetFromCatalogEntry(builtin.provider),
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
  );
}

function ChangeDefaultModelModal({
  workspaceId,
  modal,
  dispatchModal,
}: {
  workspaceId: string;
  modal: ManagementModal;
  dispatchModal: ManagementModalDispatch;
}) {
  const change = modal.kind === 'change-default-model' ? modal : null;
  return (
    <Modal
      open={change !== null}
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
            Change default model for {change?.provider.label ?? ''}
          </Text>
        </ModalHeader>
        {change ? (
          <ChangeDefaultModelForm
            workspaceId={workspaceId}
            entry={change.provider}
            config={change.config}
            onSaved={() => {
              toast.success(`${change.provider.label} default model saved`);
              dispatchModal({type: 'close'});
            }}
          />
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function CustomProviderModal({
  workspaceId,
  modal,
  dispatchModal,
}: {
  workspaceId: string;
  modal: ManagementModal;
  dispatchModal: ManagementModalDispatch;
}) {
  const custom = modal.kind === 'create-custom' || modal.kind === 'edit-custom' ? modal : null;
  return (
    <Modal
      open={custom !== null}
      onOpenChange={(open) => (open ? undefined : dispatchModal({type: 'close'}))}
    >
      <ModalContent aria-describedby={undefined} className="max-h-[calc(100vh-32px)] max-w-[760px]">
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
        {custom ? (
          <CustomModelProviderForm
            workspaceId={workspaceId}
            existingConfig={custom.kind === 'edit-custom' ? custom.config : undefined}
            onSaved={() => {
              const message =
                custom.kind === 'edit-custom'
                  ? `${custom.config.displayName} saved`
                  : 'Custom provider saved';
              toast.success(message);
              dispatchModal({type: 'close'});
            }}
          />
        ) : null}
      </ModalContent>
    </Modal>
  );
}

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
  const managedOnly = isManagedOnlyCatalog(catalogQuery.data);
  const managedProvider = managedProviderFromCatalog(catalogQuery.data);
  const providerById = useMemo(
    () =>
      new Map<string, ProviderCatalogEntry>(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const availableProviders = configsLoaded ? selectAvailableProviders(providers, configs) : [];
  const unsupportedProviders = providers.filter(
    (provider): provider is UnsupportedProvider => !isSupportedProvider(provider),
  );

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
    return entry && isSupportedProvider(entry)
      ? usageTargetFromCatalogEntry(entry, {isManaged: managedOnly})
      : null;
  }, [configs, managedOnly, modal, providerById]);

  return (
    <div className="flex min-w-0 flex-col gap-region">
      {managedOnly ? (
        <ManagedProviderSection
          provider={managedProvider}
          onShowUsage={() => {
            if (!managedProvider) return;
            dispatchModal({
              type: 'show-usage',
              providerId: managedProvider.id,
              initialModel: managedProvider.defaultModel,
              restoreFocusToConfiguredProviders: false,
            });
          }}
        />
      ) : (
        <>
          <ConfiguredProvidersSection
            workspaceId={workspaceId}
            regionRef={configuredProvidersRegionRef}
            query={configsQuery}
            configs={configs}
            providerById={providerById}
            defaultProviderId={defaultProviderId}
            dispatchModal={dispatchModal}
            setPendingUsageTarget={setPendingUsageTarget}
          />

          <AvailableProvidersSection
            catalogQuery={catalogQuery}
            configsPending={configsQuery.isPending}
            configsLoaded={configsLoaded}
            providers={availableProviders}
            dispatchModal={dispatchModal}
          />
          <UnsupportedProvidersSection
            loading={catalogQuery.isPending}
            providers={unsupportedProviders}
          />
        </>
      )}

      <BuiltinProviderModal
        workspaceId={workspaceId}
        modal={modal}
        configuredCount={configs.length}
        dispatchModal={dispatchModal}
        setPendingUsageTarget={setPendingUsageTarget}
      />
      <ChangeDefaultModelModal
        workspaceId={workspaceId}
        modal={modal}
        dispatchModal={dispatchModal}
      />

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

      <CustomProviderModal workspaceId={workspaceId} modal={modal} dispatchModal={dispatchModal} />
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
    <PanelRow asChild className="flex-col items-stretch gap-inline">
      <li>
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
    </PanelRow>
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
                <Skeleton className="size-32 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-inline">
                  <Skeleton className="h-16 w-120" />
                  <Skeleton className="h-14 w-180" />
                </div>
                <Skeleton className="h-28 w-96 shrink-0" />
              </li>
            </PanelRow>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
