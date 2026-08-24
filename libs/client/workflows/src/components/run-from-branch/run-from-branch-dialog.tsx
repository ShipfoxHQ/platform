import {isErrorWithCode} from '@shipfox/client-api';
import {Alert, AlertDescription, AlertTitle} from '@shipfox/react-ui/alert';
import {StatusBadge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {FormField, FormFieldInput} from '@shipfox/react-ui/form-field';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useEffect, useState} from 'react';
import type {
  DefinitionAtRefDiagnostic,
  DefinitionAtRefFile,
  DefinitionAtRefWarning,
} from '#core/definitions-at-ref.js';
import {
  type RunFromBranchInputRow,
  runFromBranchInputsFromWith,
  runFromBranchInputsToObject,
  runFromBranchTriggerKind,
  runFromBranchTriggerSourceLabel,
} from '#core/run-from-branch.js';
import {
  definitionsAtRefErrorCopy,
  useDefinitionsAtRefQuery,
} from '#hooks/api/definitions-at-ref.js';
import {devRunErrorCopy, useCreateDevRunMutation} from '#hooks/api/dev-runs.js';

/**
 * A journaled event fixed by the calling surface. The events-page entry point
 * (a later issue) opens the dialog with an event pinned: only triggers whose
 * source and event match are selectable then, and the replay id is submitted
 * with the run. Until the event picker step lands, integration-sourced
 * triggers are disabled, so this prop only reserves the API seam.
 */
export interface RunFromBranchFixedEvent {
  id: string;
  source: string;
  event: string;
}

export interface RunFromBranchDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed journaled event for replay entry points; unused until the picker step lands. */
  fixedEvent?: RunFromBranchFixedEvent | undefined;
  /** Called with the created run id; the caller owns navigation to the run detail. */
  onRunCreated?: ((workflowRunId: string) => void) | undefined;
}

type RunFromBranchStep = 'ref' | 'file' | 'trigger' | 'inputs';

interface RunFromBranchStepDef {
  id: RunFromBranchStep;
  label: string;
}

const RUN_FROM_BRANCH_STEPS: readonly RunFromBranchStepDef[] = [
  {id: 'ref', label: 'Ref'},
  {id: 'file', label: 'File'},
  {id: 'trigger', label: 'Trigger'},
  {id: 'inputs', label: 'Inputs'},
];

const SHORT_COMMIT_LENGTH = 7;

function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

function defaultTriggerEvent(kind: 'manual' | 'cron' | 'integration'): string {
  if (kind === 'manual') return 'fire';
  if (kind === 'cron') return 'tick';
  return 'any';
}

interface RunFromBranchErrorCopy {
  title: string;
  message: string;
}

/**
 * An input row with a stable identity for React keys. The draft rows are
 * editable (key and value both change), so the identity cannot be derived
 * from either field.
 */
interface RunFromBranchInputDraft extends RunFromBranchInputRow {
  id: number;
}

let inputRowIdSequence = 0;

function toInputDraft(row: RunFromBranchInputRow): RunFromBranchInputDraft {
  inputRowIdSequence += 1;
  return {id: inputRowIdSequence, ...row};
}

/**
 * The Run from branch dialog: pick a branch or tag, a workflow file at that
 * ref, and a trigger, then start a dev run from the pinned commit. The ref is
 * resolved on blur through `GET /definitions/at-ref`; invalid files cannot be
 * selected, integration-sourced triggers are disabled until the event picker
 * lands, and a `ref-moved` answer re-lists the files for confirmation.
 */
export function RunFromBranchDialog({
  projectId,
  open,
  onOpenChange,
  onRunCreated,
}: RunFromBranchDialogProps) {
  const createDevRun = useCreateDevRunMutation();

  const [step, setStep] = useState<RunFromBranchStep>('ref');
  const [refDraft, setRefDraft] = useState('');
  const [resolvedRef, setResolvedRef] = useState<string | undefined>();
  const [refBlurredEmpty, setRefBlurredEmpty] = useState(false);
  const [selectedConfigPath, setSelectedConfigPath] = useState<string | undefined>();
  const [selectedTriggerKey, setSelectedTriggerKey] = useState<string | undefined>();
  const [inputRows, setInputRows] = useState<RunFromBranchInputDraft[]>([]);
  const [refMovedCopy, setRefMovedCopy] = useState<RunFromBranchErrorCopy | null>(null);
  const [submitError, setSubmitError] = useState<RunFromBranchErrorCopy | null>(null);

  // The dialog opens fresh every time: the ref draft, the resolution, and the
  // selection belong to one run intent. Nothing is persisted per branch.
  useEffect(() => {
    if (!open) return;
    setStep('ref');
    setRefDraft('');
    setResolvedRef(undefined);
    setRefBlurredEmpty(false);
    setSelectedConfigPath(undefined);
    setSelectedTriggerKey(undefined);
    setInputRows([]);
    setRefMovedCopy(null);
    setSubmitError(null);
  }, [open]);

  const query = useDefinitionsAtRefQuery(projectId, resolvedRef);
  const listing = query.data;
  const queryErrorCopy =
    query.isError && resolvedRef ? definitionsAtRefErrorCopy(query.error) : null;
  const queryErrorIsInline =
    queryErrorCopy !== null &&
    (isErrorWithCode(query.error, 'ref-invalid') || isErrorWithCode(query.error, 'ref-not-found'));

  const selectedFile = listing?.files.find((file) => file.configPath === selectedConfigPath);
  const selectedTrigger = selectedFile?.triggers[selectedTriggerKey ?? ''];
  const selectedTriggerKind = selectedTrigger
    ? runFromBranchTriggerKind(selectedTrigger.source)
    : undefined;

  // Cron triggers take no inputs, so the inputs step exists only for manual
  // triggers; for cron the trigger step is the last one and carries the submit.
  const visibleSteps =
    selectedTriggerKind === 'manual' ? RUN_FROM_BRANCH_STEPS : RUN_FROM_BRANCH_STEPS.slice(0, 3);
  const stepIndex = visibleSteps.findIndex((stepDef) => stepDef.id === step);

  function handleRefBlur() {
    if (refDraft.trim() === '') {
      setRefBlurredEmpty(true);
      return;
    }
    const next = refDraft.trim();
    if (next === resolvedRef) {
      // Re-blurring the resolved ref after a failed resolution retries it.
      if (query.isError) void query.refetch().catch(() => undefined);
      return;
    }
    setResolvedRef(next);
    setRefBlurredEmpty(false);
    setSubmitError(null);
    setRefMovedCopy(null);
    // A different ref lists different files; the selection cannot carry over.
    setSelectedConfigPath(undefined);
    setSelectedTriggerKey(undefined);
    setInputRows([]);
  }

  const refFieldError = queryErrorIsInline
    ? queryErrorCopy?.message
    : refBlurredEmpty
      ? 'Enter a branch or tag name to run from.'
      : undefined;

  const refStepError = !queryErrorIsInline ? queryErrorCopy : null;

  const canProceed =
    step === 'inputs'
      ? true
      : step === 'trigger'
        ? selectedTrigger !== undefined && selectedTriggerKind !== 'integration'
        : step === 'file'
          ? selectedConfigPath !== undefined
          : Boolean(listing) && !query.isError;

  const isLastStep = step === 'inputs' || (step === 'trigger' && selectedTriggerKind !== 'manual');
  const primaryLabel = isLastStep ? 'Start run' : 'Next';

  function handlePrimary() {
    if (step === 'ref' || step === 'file') {
      setStep(step === 'ref' ? 'file' : 'trigger');
      setSubmitError(null);
      return;
    }
    if (step === 'trigger' && selectedTriggerKind === 'manual') {
      setStep('inputs');
      setSubmitError(null);
      return;
    }
    void handleSubmit();
  }

  function handleBack() {
    setSubmitError(null);
    if (step === 'file') setStep('ref');
    if (step === 'trigger') setStep('file');
    if (step === 'inputs') setStep('trigger');
  }

  function handleFileSelect(configPath: string) {
    setSelectedConfigPath(configPath);
    setSelectedTriggerKey(undefined);
    setInputRows([]);
    setSubmitError(null);
  }

  function handleTriggerSelect(triggerKey: string) {
    setSelectedTriggerKey(triggerKey);
    const file = listing?.files.find((entry) => entry.configPath === selectedConfigPath);
    const trigger = file?.triggers[triggerKey];
    setInputRows(runFromBranchInputsFromWith(trigger?.with).map(toInputDraft));
    setSubmitError(null);
  }

  function updateInputRow(index: number, patch: Partial<RunFromBranchInputRow>) {
    setInputRows((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? {...row, ...patch} : row)),
    );
  }

  function removeInputRow(index: number) {
    setInputRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  }

  async function handleSubmit() {
    if (
      !resolvedRef ||
      !selectedConfigPath ||
      !selectedTriggerKey ||
      !listing ||
      !selectedTrigger
    ) {
      return;
    }
    setSubmitError(null);
    try {
      const result = await createDevRun.mutateAsync({
        projectId,
        ref: resolvedRef,
        // The pinned commit is the compare-and-set value: the server answers
        // `ref-moved` when the ref no longer resolves to it.
        commit: listing.commit,
        configPath: selectedConfigPath,
        trigger: selectedTriggerKey,
        inputs:
          selectedTrigger.source === 'manual' ? runFromBranchInputsToObject(inputRows) : undefined,
      });
      onOpenChange(false);
      onRunCreated?.(result.workflowRunId);
    } catch (error) {
      if (isErrorWithCode(error, 'ref-moved')) {
        // Re-list the files at the ref's new commit and ask the user to
        // confirm again. The mutation refreshes the at-ref listing before the
        // POST; refetch here so the re-listing cannot show stale content.
        await query.refetch().catch(() => undefined);
        setRefMovedCopy(devRunErrorCopy(error));
        setSelectedConfigPath(undefined);
        setSelectedTriggerKey(undefined);
        setInputRows([]);
        setStep('file');
        return;
      }
      setSubmitError(devRunErrorCopy(error));
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent aria-describedby={undefined} className="max-w-[560px]">
        <ModalTitle className="sr-only">Run from branch</ModalTitle>
        <ModalHeader title="Run from branch" />
        <ModalBody className="gap-group">
          <RunFromBranchStepIndicator steps={visibleSteps} currentIndex={stepIndex} />
          {step === 'ref' ? (
            <div className="flex w-full flex-col gap-group">
              <FormField
                label="Branch or tag"
                id="run-from-branch-ref"
                error={refFieldError}
                description="A branch or tag in the project repository. The commit it points at is pinned for the run."
              >
                <FormFieldInput
                  className="font-code"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="fix-triage-prompt"
                  value={refDraft}
                  onChange={(event) => {
                    setRefDraft(event.target.value);
                    if (event.target.value.trim() !== '') setRefBlurredEmpty(false);
                  }}
                  onBlur={handleRefBlur}
                />
              </FormField>

              {resolvedRef && query.isPending ? (
                <Text size="xs" className="text-foreground-neutral-muted">
                  Resolving {resolvedRef}…
                </Text>
              ) : null}
              {resolvedRef && listing ? (
                <div className="flex items-center gap-inline">
                  <StatusBadge variant="success">Resolved</StatusBadge>
                  <Text size="xs" className="text-foreground-neutral-muted">
                    Pinned commit
                  </Text>
                  <Code variant="label">{shortCommit(listing.commit)}</Code>
                  <Text size="xs" className="text-foreground-neutral-muted">
                    {listing.files.length} {listing.files.length === 1 ? 'file' : 'files'}
                  </Text>
                </div>
              ) : null}

              {refStepError ? (
                <Alert variant="error">
                  <AlertTitle>{refStepError.title}</AlertTitle>
                  <AlertDescription>{refStepError.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          {step === 'file' && listing ? (
            <div className="flex w-full flex-col gap-group">
              {refMovedCopy ? (
                <Alert variant="warning">
                  <AlertTitle>{refMovedCopy.title}</AlertTitle>
                  <AlertDescription>{refMovedCopy.message}</AlertDescription>
                </Alert>
              ) : null}
              {listing.files.length === 0 ? (
                <Text size="sm" className="text-foreground-neutral-muted">
                  No workflow files found at this ref.
                </Text>
              ) : (
                <RadioGroup
                  variant="card"
                  value={selectedConfigPath ?? ''}
                  onValueChange={handleFileSelect}
                >
                  {listing.files.map((file) => (
                    <RunFromBranchFileItem
                      key={file.configPath}
                      file={file}
                      disabled={!file.valid}
                    />
                  ))}
                </RadioGroup>
              )}
            </div>
          ) : null}

          {step === 'trigger' ? (
            <div className="flex w-full flex-col gap-group">
              {selectedFile === undefined ? (
                <Text size="sm" className="text-foreground-neutral-muted">
                  The selected file is no longer at this ref.
                </Text>
              ) : Object.keys(selectedFile.triggers).length === 0 ? (
                <Text size="sm" className="text-foreground-neutral-muted">
                  This file declares no triggers.
                </Text>
              ) : (
                <RadioGroup
                  variant="card"
                  value={selectedTriggerKey ?? ''}
                  onValueChange={handleTriggerSelect}
                >
                  {Object.entries(selectedFile.triggers).map(([triggerKey, trigger]) => {
                    const kind = runFromBranchTriggerKind(trigger.source);
                    const selectable = kind !== 'integration';
                    return (
                      <RadioGroupItem key={triggerKey} value={triggerKey} disabled={!selectable}>
                        <div className="flex w-full items-center gap-inline">
                          <Text size="sm" bold className="min-w-0 truncate">
                            {triggerKey}
                          </Text>
                          <StatusBadge
                            variant={
                              kind === 'manual' ? 'info' : kind === 'cron' ? 'feature' : 'neutral'
                            }
                          >
                            {runFromBranchTriggerSourceLabel(trigger.source)}
                          </StatusBadge>
                        </div>
                        <Text size="xs" className="text-foreground-neutral-muted">
                          Event {trigger.event ?? defaultTriggerEvent(kind)}
                        </Text>
                        {!selectable ? (
                          <Text size="xs" className="text-tag-warning-text">
                            Replay arrives in a later release.
                          </Text>
                        ) : null}
                      </RadioGroupItem>
                    );
                  })}
                </RadioGroup>
              )}
            </div>
          ) : null}

          {step === 'inputs' && selectedTrigger && selectedTrigger.source === 'manual' ? (
            <div className="flex w-full flex-col gap-group">
              <Text size="xs" className="text-foreground-neutral-muted">
                Inputs override the trigger's{' '}
                <Code as="span" variant="label">
                  with
                </Code>{' '}
                block for this run.
              </Text>
              {inputRows.length === 0 ? (
                <Text size="sm" className="text-foreground-neutral-muted">
                  This trigger takes no inputs.
                </Text>
              ) : (
                <div className="flex w-full flex-col gap-inline">
                  {inputRows.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-inline"
                    >
                      <FormField
                        label={`Input ${index + 1} key`}
                        id={`run-from-branch-input-key-${index}`}
                      >
                        <FormFieldInput
                          className="font-code"
                          autoComplete="off"
                          spellCheck={false}
                          value={row.key}
                          onChange={(event) => updateInputRow(index, {key: event.target.value})}
                        />
                      </FormField>
                      <FormField
                        label={`Input ${index + 1} value`}
                        id={`run-from-branch-input-value-${index}`}
                      >
                        <FormFieldInput
                          className="font-code"
                          autoComplete="off"
                          spellCheck={false}
                          value={row.value}
                          onChange={(event) => updateInputRow(index, {value: event.target.value})}
                        />
                      </FormField>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        aria-label={`Remove input ${index + 1}`}
                        onClick={() => removeInputRow(index)}
                      >
                        <Icon name="close" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setInputRows((rows) => [...rows, toInputDraft({key: '', value: ''})])
                  }
                >
                  Add input
                </Button>
              </div>
            </div>
          ) : null}

          {submitError ? (
            <Alert variant="error">
              <AlertTitle>{submitError.title}</AlertTitle>
              <AlertDescription>{submitError.message}</AlertDescription>
            </Alert>
          ) : null}
        </ModalBody>
        <ModalFooter>
          {step !== 'ref' ? (
            <Button variant="secondary" onClick={handleBack} disabled={createDevRun.isPending}>
              Back
            </Button>
          ) : null}
          <Button onClick={handlePrimary} isLoading={createDevRun.isPending} disabled={!canProceed}>
            {primaryLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function RunFromBranchFileItem({file, disabled}: {file: DefinitionAtRefFile; disabled: boolean}) {
  return (
    <RadioGroupItem value={file.configPath} disabled={disabled}>
      <div className="flex w-full items-center gap-inline">
        <Text size="sm" bold className="min-w-0 truncate">
          {file.name ?? 'Unnamed workflow'}
        </Text>
        {!file.valid ? (
          <StatusBadge variant="error">Invalid</StatusBadge>
        ) : file.warnings.length > 0 ? (
          <StatusBadge variant="warning">Warnings</StatusBadge>
        ) : null}
      </div>
      <Code className="truncate text-foreground-neutral-muted">{file.configPath}</Code>
      {!file.valid && file.errors.length > 0 ? (
        <ul className="flex flex-col gap-tight">
          {file.errors.map((diagnostic) => (
            <RunFromBranchDiagnosticRow
              key={`${file.configPath}-error-${diagnostic.path ?? ''}-${diagnostic.message}`}
              diagnostic={diagnostic}
              severity="error"
            />
          ))}
        </ul>
      ) : null}
      {file.valid && file.warnings.length > 0 ? (
        <ul className="flex flex-col gap-tight">
          {file.warnings.map((warning) => (
            <RunFromBranchDiagnosticRow
              key={`${file.configPath}-warning-${warning.path ?? ''}-${warning.message}`}
              diagnostic={warning}
              severity="warning"
            />
          ))}
        </ul>
      ) : null}
    </RadioGroupItem>
  );
}

function RunFromBranchDiagnosticRow({
  diagnostic,
  severity,
}: {
  diagnostic: DefinitionAtRefDiagnostic | DefinitionAtRefWarning;
  severity: 'error' | 'warning';
}) {
  return (
    <li className="flex flex-col gap-tight">
      {diagnostic.path ? (
        <Code variant="label" className="text-foreground-neutral-muted">
          {diagnostic.path}
        </Code>
      ) : null}
      <Text
        size="xs"
        className={severity === 'error' ? 'text-tag-error-text' : 'text-foreground-neutral-muted'}
      >
        <span className="font-medium">{severity === 'error' ? 'Error:' : 'Warning:'}</span>{' '}
        {diagnostic.message}
      </Text>
    </li>
  );
}

function RunFromBranchStepIndicator({
  steps,
  currentIndex,
}: {
  steps: readonly RunFromBranchStepDef[];
  currentIndex: number;
}) {
  return (
    <ol className="flex w-full items-center gap-inline" aria-label="Run from branch steps">
      {steps.map((stepDef, index) => {
        const state =
          index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
        return (
          <li key={stepDef.id} className="flex min-w-0 items-center gap-inline">
            {index > 0 ? (
              <span aria-hidden="true" className="h-px w-16 shrink-0 bg-border-neutral-base" />
            ) : null}
            <span
              className={cn(
                'flex items-center gap-tight text-xs whitespace-nowrap',
                state === 'current'
                  ? 'text-foreground-neutral-base'
                  : 'text-foreground-neutral-muted',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-16 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none',
                  state === 'current'
                    ? 'border-border-highlights-interactive'
                    : 'border-border-neutral-base',
                )}
              >
                {state === 'done' ? <Icon name="check" className="size-10" /> : index + 1}
              </span>
              {stepDef.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
