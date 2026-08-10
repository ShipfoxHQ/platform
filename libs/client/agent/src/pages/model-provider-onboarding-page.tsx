import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Card} from '@shipfox/react-ui/card';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Modal, ModalContent, ModalHeader, ModalTitle} from '@shipfox/react-ui/modal';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useEffect, useMemo, useReducer} from 'react';
import {AvailableProvidersGrid, PROVIDER_GRID_CLASS} from '#components/available-providers-grid.js';
import {modelProviderConfigErrorToFormError} from '#components/form-errors.js';
import {ModelProviderTestAndSaveForm} from '#components/test-and-save-form.js';
import {DEFAULT_HARNESS, harnessSupportsProvider, listHarnesses} from '#core/harness-policy.js';
import type {HarnessDescriptor, HarnessId, SupportedProvider} from '#core/models.js';
import {initialOnboardingState, onboardingReducer} from '#core/onboarding-reducer.js';
import {isSupportedProvider} from '#core/provider-policy.js';
import {
  useModelProviderCatalogQuery,
  useSetDefaultHarnessMutation,
} from '#hooks/api/model-providers.js';
import {dismissModelProviderOnboarding} from '#state/model-provider-onboarding.js';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function ModelProviderOnboardingPage({
  workspaceId,
  onSkip,
  onConfigured,
}: {
  workspaceId: string;
  onSkip: () => void;
  onConfigured: () => void;
}) {
  const catalogQuery = useModelProviderCatalogQuery();
  const setDefaultHarness = useSetDefaultHarnessMutation();
  const [onboarding, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const supportedProviders = catalogQuery.data?.providers.filter(isSupportedProvider) ?? [];
  const filteredProviders = useMemo(() => {
    if (onboarding.step === 'choose-harness') return [];
    return supportedProviders.filter((provider) =>
      harnessSupportsProvider(onboarding.harnessId, provider.id),
    );
  }, [onboarding, supportedProviders]);

  useEffect(() => {
    document
      .getElementById(
        onboarding.step === 'choose-harness'
          ? 'model-provider-harness-step'
          : 'model-provider-provider-step',
      )
      ?.focus();
  }, [onboarding.step]);

  function handleSkip() {
    try {
      dismissModelProviderOnboarding(workspaceId);
    } catch {
      // Skip is best-effort persistence; access to the product must not depend on storage.
    }
    onSkip();
  }

  async function handleProviderSaved() {
    if (onboarding.step !== 'configure-provider' && onboarding.step !== 'saving-default-harness')
      return;

    const provider = onboarding.provider;
    if (onboarding.step === 'configure-provider') dispatch({type: 'provider-saved'});
    if (onboarding.harnessId === DEFAULT_HARNESS) {
      toast.success(`${provider.label} saved`);
      dispatch({type: 'default-harness-saved'});
      onConfigured();
      return;
    }

    try {
      await setDefaultHarness.mutateAsync({
        workspaceId,
        harnessId: onboarding.harnessId,
      });
      toast.success(`${provider.label} saved`);
      dispatch({type: 'default-harness-saved'});
      onConfigured();
    } catch (error) {
      const mapped = modelProviderConfigErrorToFormError(error);
      dispatch({
        type: 'default-harness-failed',
        message: mapped.message || 'Could not save default harness. Try again.',
      });
    }
  }

  const selectedHarnessDescriptor =
    onboarding.step === 'choose-harness'
      ? null
      : listHarnesses().find((harness) => harness.id === onboarding.harnessId);
  const headingId =
    onboarding.step === 'choose-harness'
      ? 'model-provider-harness-step'
      : 'model-provider-provider-step';

  return (
    <div className="mx-auto flex w-full flex-col gap-section">
      <header className="flex flex-col gap-cluster">
        <div className="flex items-start justify-between gap-group max-[520px]:flex-col max-[520px]:gap-inline">
          <Header id={headingId} variant="h1" tabIndex={-1} className="outline-none">
            {selectedHarnessDescriptor
              ? `Configure ${selectedHarnessDescriptor.label}`
              : 'Choose agent harness'}
          </Header>
          <Button type="button" variant="secondary" onClick={handleSkip} className="shrink-0">
            Skip for now
          </Button>
        </div>
        <Text size="md" className="text-foreground-neutral-muted">
          {selectedHarnessDescriptor
            ? `${selectedHarnessDescriptor.label} needs a compatible model provider. Add your own API key, or go back to choose a different harness.`
            : 'A harness runs agent steps. Choose the engine you want first, then connect a compatible model provider.'}
        </Text>
      </header>

      <section aria-labelledby={headingId} className="flex flex-col gap-group">
        {onboarding.step === 'choose-harness' ? (
          <HarnessPicker
            onSelect={(harnessId) => dispatch({type: 'harness-selected', harnessId})}
          />
        ) : (
          <>
            <div>
              <Button type="button" variant="transparent" onClick={() => dispatch({type: 'back'})}>
                Back
              </Button>
            </div>
            <ModelProviderPicker
              key={onboarding.harnessId}
              catalogQuery={catalogQuery}
              supportedProviders={filteredProviders}
              onSelect={(entry) => {
                dispatch({type: 'provider-selected', provider: entry});
              }}
            />
          </>
        )}
      </section>

      <Modal
        open={
          onboarding.step === 'configure-provider' || onboarding.step === 'saving-default-harness'
        }
        onOpenChange={(open) => {
          if (!open && onboarding.step === 'configure-provider') dispatch({type: 'back'});
        }}
      >
        <ModalContent aria-describedby={undefined}>
          <ModalTitle className="sr-only">
            {onboarding.step === 'configure-provider' ||
            onboarding.step === 'saving-default-harness'
              ? `Configure ${onboarding.provider.label}`
              : ''}
          </ModalTitle>
          <ModalHeader>
            <Text
              size="lg"
              aria-hidden="true"
              className="overflow-ellipsis overflow-hidden whitespace-nowrap"
            >
              {onboarding.step === 'configure-provider' ||
              onboarding.step === 'saving-default-harness'
                ? `Configure ${onboarding.provider.label}`
                : ''}
            </Text>
          </ModalHeader>
          {onboarding.step === 'configure-provider' ||
          onboarding.step === 'saving-default-harness' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-inline">
              {onboarding.step === 'saving-default-harness' ? (
                <div role="status" className="px-row">
                  <Text size="sm" className="text-foreground-neutral-muted">
                    Saving harness default...
                  </Text>
                </div>
              ) : null}
              {onboarding.step === 'saving-default-harness' && onboarding.error ? (
                <div className="px-row">
                  <Callout role="alert" type="error">
                    <div className="flex flex-col gap-inline">
                      <Text size="sm" bold>
                        Could not save default harness
                      </Text>
                      <Text size="sm">{onboarding.error}</Text>
                    </div>
                  </Callout>
                </div>
              ) : null}
              <div className="flex min-h-0 flex-1 flex-col">
                <ModelProviderTestAndSaveForm
                  workspaceId={workspaceId}
                  entry={onboarding.provider}
                  setAsDefaultOnSave
                  onSaved={() => {
                    void handleProviderSaved();
                  }}
                />
              </div>
            </div>
          ) : null}
        </ModalContent>
      </Modal>
    </div>
  );
}

function HarnessPicker({onSelect}: {onSelect: (harness: HarnessId) => void}) {
  return (
    <ul className={PROVIDER_GRID_CLASS} aria-label="Agent harnesses">
      {listHarnesses().map((harness) => (
        <HarnessCard key={harness.id} harness={harness} onChoose={() => onSelect(harness.id)} />
      ))}
    </ul>
  );
}

function HarnessCard({harness, onChoose}: {harness: HarnessDescriptor; onChoose: () => void}) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          'group block w-full cursor-pointer p-panel-compact text-left outline-none transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus',
          SURFACE_CLASS,
        )}
        aria-label={`Choose ${harness.label}`}
        onClick={onChoose}
      >
        <div className="flex min-w-0 items-center justify-between gap-cluster">
          <div className="flex min-w-0 flex-col gap-tight">
            <Text size="md" bold className="min-w-0 truncate">
              {harness.label}
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              {harness.description}
            </Text>
          </div>
          <div className="flex shrink-0 items-center gap-tight text-foreground-neutral-muted transition-colors group-hover:text-foreground-highlight-interactive">
            <Text size="sm">Choose</Text>
            <Icon name="chevronRight" className="size-16" />
          </div>
        </div>
      </button>
    </li>
  );
}

function ModelProviderPicker({
  catalogQuery,
  supportedProviders,
  onSelect,
}: {
  catalogQuery: ReturnType<typeof useModelProviderCatalogQuery>;
  supportedProviders: SupportedProvider[];
  onSelect: (entry: SupportedProvider) => void;
}) {
  if (catalogQuery.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading model providers">
        <ModelProviderGridSkeleton />
      </div>
    );
  }

  if (catalogQuery.isError && catalogQuery.data === undefined) {
    return <QueryLoadError query={catalogQuery} subject="model provider catalog" />;
  }

  if (catalogQuery.data !== undefined && supportedProviders.length === 0) {
    return (
      <EmptyState
        icon="componentLine"
        title="No providers available to configure"
        description="Skip for now and add one later from workspace settings."
      />
    );
  }

  return <AvailableProvidersGrid entries={supportedProviders} onSelect={onSelect} />;
}

function ModelProviderGridSkeleton() {
  return (
    <div className={PROVIDER_GRID_CLASS}>
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
