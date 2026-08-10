import {QueryLoadError} from '@shipfox/client-ui';
import {IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {Icon} from '@shipfox/react-ui/icon';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Header, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useRef, useState} from 'react';
import {DEFAULT_HARNESS, listHarnesses} from '#core/harness-policy.js';
import type {HarnessDescriptor, HarnessId} from '#core/models.js';
import {
  useModelProviderConfigsQuery,
  useSetDefaultHarnessMutation,
} from '#hooks/api/model-providers.js';
import {modelProviderConfigErrorToFormError} from './form-errors.js';
import {isHarnessAvailable} from './harness-availability.js';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function WorkspaceHarnessesSection({workspaceId}: {workspaceId: string}) {
  const configsQuery = useModelProviderConfigsQuery(workspaceId);
  const setDefaultHarness = useSetDefaultHarnessMutation();
  const activeWorkspaceIdRef = useRef(workspaceId);
  const defaultRequestSeqRef = useRef(0);
  const activeDefaultRequestRef = useRef<{workspaceId: string; id: number} | null>(null);
  const [pendingDefaultHarness, setPendingDefaultHarness] = useState<{
    workspaceId: string;
    harnessId: HarnessId;
  } | null>(null);
  const [defaultError, setDefaultError] = useState<
    {workspaceId: string; harnessId: HarnessId; message: string} | undefined
  >();
  const configs = configsQuery.data?.configs ?? [];
  const defaultHarnessId = configsQuery.data?.defaultHarnessId ?? DEFAULT_HARNESS;
  activeWorkspaceIdRef.current = workspaceId;

  function isActiveDefaultRequest(request: {workspaceId: string; id: number}) {
    const activeRequest = activeDefaultRequestRef.current;
    return (
      activeWorkspaceIdRef.current === request.workspaceId &&
      activeRequest?.workspaceId === request.workspaceId &&
      activeRequest.id === request.id
    );
  }

  async function handleSetDefault(harness: HarnessDescriptor) {
    if (activeDefaultRequestRef.current?.workspaceId === workspaceId) return;

    const request = {workspaceId, id: defaultRequestSeqRef.current + 1};
    defaultRequestSeqRef.current = request.id;
    activeDefaultRequestRef.current = request;
    setPendingDefaultHarness({workspaceId, harnessId: harness.id});
    setDefaultError(undefined);
    try {
      await setDefaultHarness.mutateAsync({
        workspaceId,
        harnessId: harness.id,
      });
      if (!isActiveDefaultRequest(request)) return;
      toast.success(`${harness.label} is now the default harness`);
    } catch (error) {
      if (!isActiveDefaultRequest(request)) return;
      const mapped = modelProviderConfigErrorToFormError(error);
      setDefaultError({
        workspaceId,
        harnessId: harness.id,
        message: mapped.message || 'Could not save default harness. Try again.',
      });
    } finally {
      if (isActiveDefaultRequest(request)) {
        activeDefaultRequestRef.current = null;
        setPendingDefaultHarness(null);
      }
    }
  }

  return (
    <section className="flex flex-col gap-group" aria-label="Harnesses">
      <div className="flex flex-col gap-tight">
        <Header variant="h3">Harnesses</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Harnesses available to run agent steps in this workspace.
        </Text>
      </div>

      {configsQuery.isPending ? <HarnessRowsSkeleton /> : null}

      {configsQuery.isError && configsQuery.data === undefined ? (
        <div className={SURFACE_CLASS}>
          <QueryLoadError query={configsQuery} subject="harnesses" variant="panel" />
        </div>
      ) : null}

      {configsQuery.data !== undefined ? (
        <ul className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}>
          {listHarnesses().map((harness) => (
            <HarnessRow
              key={harness.id}
              harness={harness}
              isDefault={harness.id === defaultHarnessId}
              isAvailable={isHarnessAvailable(harness, configs)}
              isSettingDefault={pendingDefaultHarness?.workspaceId === workspaceId}
              defaultError={
                defaultError?.workspaceId === workspaceId && defaultError.harnessId === harness.id
                  ? defaultError.message
                  : undefined
              }
              onSetDefault={handleSetDefault}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function HarnessRow({
  harness,
  isDefault,
  isAvailable,
  isSettingDefault,
  defaultError,
  onSetDefault,
}: {
  harness: HarnessDescriptor;
  isDefault: boolean;
  isAvailable: boolean;
  isSettingDefault: boolean;
  defaultError: string | undefined;
  onSetDefault: (harness: HarnessDescriptor) => void;
}) {
  const unavailableCopy = harnessUnavailableCopy(isDefault);

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
                <TooltipContent>Default harness</TooltipContent>
              </Tooltip>
              <span className="sr-only">Default harness</span>
            </>
          ) : null}
          <Text size="md" bold className="truncate">
            {harness.label}
          </Text>
          {!isAvailable ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex size-16 shrink-0 items-center justify-center">
                    <Icon
                      name="errorWarningLine"
                      className="size-16 text-foreground-warning-base"
                      aria-hidden
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{unavailableCopy}</TooltipContent>
              </Tooltip>
              <span className="sr-only">{unavailableCopy}</span>
            </>
          ) : null}
        </div>
        {!isDefault ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                variant="transparent"
                icon="more2Line"
                disabled={isSettingDefault}
                aria-label={`Open ${harness.label} harness actions`}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                icon="starLine"
                disabled={isSettingDefault || !isAvailable}
                onSelect={() => {
                  onSetDefault(harness);
                }}
              >
                Set as default
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {defaultError ? (
        <Callout role="alert" type="error">
          <Text size="sm">{defaultError}</Text>
        </Callout>
      ) : null}
    </li>
  );
}

function harnessUnavailableCopy(isDefault: boolean): string {
  const base = 'Configure a compatible model provider to use this harness.';
  if (!isDefault) return base;
  return `${base} The stored default harness cannot currently run in this workspace.`;
}

function HarnessRowsSkeleton() {
  return (
    <ul
      role="status"
      aria-label="Loading harnesses"
      className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}
    >
      {[0, 1].map((row) => (
        <li key={row} className="flex items-center gap-cluster px-row py-row">
          <Skeleton className="size-16 shrink-0" />
          <Skeleton className="h-16 w-120" />
          <Skeleton className="ml-auto size-28 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
