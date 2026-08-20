import {Button} from '@shipfox/react-ui/button';
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
import {Combobox} from '@shipfox/react-ui/combobox';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useEffect, useMemo, useRef, useState} from 'react';
import {DEFAULT_HARNESS, getHarness, listHarnesses} from '#core/harness-policy.js';
import type {HarnessId} from '#core/models.js';
import {buildAgentWorkflowExample} from './agent-workflow-example.js';
import {compatibleHarnessIds} from './harness-availability.js';
import type {ModelProviderUsageTarget} from './model-provider-usage-target.js';

type CopyState = 'idle' | 'copied' | 'failed';

const WORKFLOW_EXAMPLE_FILENAME = '.shipfox/workflows/agent.yml';

export function ModelProviderUsageModal({
  target,
  initialModel,
  open,
  onOpenChange,
  closeFocusTarget,
  workspaceDefaultHarnessId,
}: {
  target: ModelProviderUsageTarget | null;
  initialModel?: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeFocusTarget?: HTMLElement | null | undefined;
  workspaceDefaultHarnessId?: HarnessId | null | undefined;
}) {
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedHarness, setSelectedHarness] = useState<HarnessId>(DEFAULT_HARNESS);

  useEffect(() => {
    if (!target) return;
    setSelectedModel(initialModel ?? target.defaultModel ?? target.models[0]?.id ?? '');
  }, [target, initialModel]);

  useEffect(() => {
    if (!target) return;
    const nextCompatibleHarnessIds = compatibleHarnessIds({
      isCustom: target.isCustom,
      isManaged: target.isManaged,
      providerId: target.id,
    });
    setSelectedHarness(selectInitialHarness(nextCompatibleHarnessIds, workspaceDefaultHarnessId));
  }, [target, workspaceDefaultHarnessId]);

  const compatibleIds = useMemo(
    () =>
      target
        ? compatibleHarnessIds({
            isCustom: target.isCustom,
            isManaged: target.isManaged,
            providerId: target.id,
          })
        : ([] as HarnessId[]),
    [target],
  );
  const harnessOptions = useMemo(
    () =>
      compatibleIds.map((harnessId) => ({
        value: harnessId,
        label: getHarness(harnessId).label,
      })),
    [compatibleIds],
  );
  const modelOptions = useMemo(
    () => target?.models.map((model) => ({value: model.id, label: model.label})) ?? [],
    [target],
  );
  const example = target
    ? buildAgentWorkflowExample({
        harness: selectedHarness,
        providerId: target.id,
        model: selectedModel,
      })
    : null;
  const data =
    example === null
      ? []
      : [{language: 'yaml', filename: WORKFLOW_EXAMPLE_FILENAME, code: example.code}];

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen && closeFocusTarget) {
      window.setTimeout(() => closeFocusTarget.focus(), 0);
    }
  }

  return (
    <Modal open={open && target !== null} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined} className="max-h-[calc(100vh-32px)] max-w-[640px]">
        <ModalTitle className="sr-only">
          {target ? `Use ${target.label} in a workflow` : 'Use provider in a workflow'}
        </ModalTitle>
        <ModalHeader>
          <div className="flex min-w-0 flex-col gap-tight">
            <Text size="lg" aria-hidden="true" className="truncate">
              {target ? `Use ${target.label} in a workflow` : 'Use provider in a workflow'}
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              Reference this provider from a workflow agent step.
            </Text>
          </div>
        </ModalHeader>
        {target && example ? (
          <>
            <ModalBody className="min-h-0 flex-1 gap-0 overflow-y-auto overflow-x-clip scrollbar">
              <div className="flex w-full flex-col gap-section">
                {compatibleIds.length === 1 ? (
                  <div className="flex flex-col gap-cluster">
                    <div className="flex min-h-40 items-center justify-between gap-cluster rounded-8 border border-border-neutral-base px-row py-row">
                      <Text size="sm" className="text-foreground-neutral-muted">
                        Harness
                      </Text>
                      <Code as="span" variant="label">
                        {compatibleIds[0]}
                      </Code>
                    </div>
                    <Combobox
                      aria-label="Model"
                      options={modelOptions}
                      value={selectedModel}
                      onValueChange={(value) => {
                        if (value) setSelectedModel(value);
                      }}
                      placeholder="Select model..."
                      searchPlaceholder="Search models..."
                      emptyState="No model found."
                      className="w-full"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-cluster sm:flex-row sm:gap-cluster">
                    <Combobox
                      aria-label="Harness"
                      options={harnessOptions}
                      value={selectedHarness}
                      onValueChange={(value) => {
                        if (isHarness(value)) setSelectedHarness(value);
                      }}
                      placeholder="Select harness..."
                      searchPlaceholder="Search harnesses..."
                      emptyState="No harness found."
                      className="w-full sm:flex-1"
                    />
                    <Combobox
                      aria-label="Model"
                      options={modelOptions}
                      value={selectedModel}
                      onValueChange={(value) => {
                        if (value) setSelectedModel(value);
                      }}
                      placeholder="Select model..."
                      searchPlaceholder="Search models..."
                      emptyState="No model found."
                      className="w-full sm:flex-1"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-inline">
                  <CodeBlock data={data} className="h-auto min-h-0 rounded-8">
                    <CodeBlockHeader>
                      <CodeBlockFiles>
                        {(item) => (
                          <CodeBlockFilename value={item.filename}>
                            {item.filename}
                          </CodeBlockFilename>
                        )}
                      </CodeBlockFiles>
                      <CodeBlockCopyButton />
                    </CodeBlockHeader>
                    <CodeBlockBody>
                      {(item) => (
                        <CodeBlockItem value={item.filename}>
                          <CodeBlockContent
                            language="yaml"
                            syntaxHighlighting
                            highlightedLineRange={example.highlightedLineRange}
                          >
                            {item.code}
                          </CodeBlockContent>
                        </CodeBlockItem>
                      )}
                    </CodeBlockBody>
                  </CodeBlock>

                  <Text size="sm" className="text-foreground-neutral-muted">
                    Add this to a workflow file under{' '}
                    <Code as="span" variant="label">
                      .shipfox/workflows/
                    </Code>{' '}
                    in your repository to run it.
                  </Text>
                </div>

                <div className="flex flex-col gap-inline">
                  <Text size="sm" bold>
                    Available models ({target.models.length})
                  </Text>
                  <ul className="rounded-8 border border-border-neutral-base">
                    {target.models.map((model) => (
                      <ModelProviderModelRow key={model.id} label={model.label} id={model.id} />
                    ))}
                  </ul>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function selectInitialHarness(
  compatibleIds: HarnessId[],
  workspaceDefaultHarnessId: HarnessId | null | undefined,
): HarnessId {
  if (workspaceDefaultHarnessId && compatibleIds.includes(workspaceDefaultHarnessId)) {
    return workspaceDefaultHarnessId;
  }
  if (compatibleIds.includes(DEFAULT_HARNESS)) return DEFAULT_HARNESS;
  return compatibleIds[0] ?? DEFAULT_HARNESS;
}

function isHarness(value: string): value is HarnessId {
  return listHarnesses().some((descriptor) => descriptor.id === value);
}

function ModelProviderModelRow({label, id}: {label: string; id: string}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: id,
    onCopy: () => {
      setTemporaryCopyState('copied');
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function setTemporaryCopyState(state: Exclude<CopyState, 'idle'>) {
    setCopyState(state);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopyState('idle'), 2500);
  }

  async function handleCopy() {
    try {
      await copy();
    } catch {
      setTemporaryCopyState('failed');
    }
  }

  return (
    <li className="border-b border-border-neutral-base last:border-b-0">
      <Tooltip open={copyState === 'copied'}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Copy ${label} model id ${id}`}
            className="flex min-h-40 w-full min-w-0 flex-col items-start gap-tight px-row py-row text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none sm:flex-row sm:items-center sm:gap-inline"
            onClick={() => {
              void handleCopy();
            }}
          >
            <Text as="span" size="sm" bold className="max-w-full shrink-0 truncate sm:max-w-[48%]">
              {label}
            </Text>
            <Code
              as="span"
              variant="label"
              className="min-w-0 max-w-full truncate text-left text-foreground-neutral-muted sm:flex-1 sm:text-right"
            >
              {id}
            </Code>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          Copied
        </TooltipContent>
      </Tooltip>
      {copyState === 'copied' ? (
        <span className="sr-only" role="status">
          Copied {label} id
        </span>
      ) : null}
      {copyState === 'failed' ? (
        <span className="sr-only" role="status">
          Could not copy {label} id
        </span>
      ) : null}
    </li>
  );
}
