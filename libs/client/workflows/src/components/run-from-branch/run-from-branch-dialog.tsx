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
import {useEffect, useRef, useState} from 'react';
import type {
  DefinitionAtRefDiagnostic,
  DefinitionAtRefFile,
  DefinitionAtRefTrigger,
  DefinitionAtRefWarning,
} from '#core/definitions-at-ref.js';
import {
  type RunFromBranchInputRow,
  type RunFromBranchTriggerKind,
  runFromBranchDuplicateKeys,
  runFromBranchInputsFromWith,
  runFromBranchInputsToObject,
  runFromBranchTriggerDefaultEvent,
  runFromBranchTriggerKind,
  runFromBranchTriggerSourceLabel,
} from '#core/run-from-branch.js';
import {
  definitionsAtRefErrorCopy,
  useDefinitionsAtRefQuery,
} from '#hooks/api/definitions-at-ref.js';
import {devRunErrorCopy, useCreateDevRunMutation} from '#hooks/api/dev-runs.js';

/**
 * A journaled event fixed by the calling surface. When set, only triggers
 * whose source and event match are selectable, and the replay id is submitted
 * with the run. Without a fixed event, integration-sourced triggers are
 * disabled because their runs replay a journaled event.
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
  /** Fixed journaled event for replay entry points: restricts the selectable triggers and submits the replay id. */
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

/**
 * The Run from branch dialog: pick a branch or tag, a workflow file at that
 * ref, and a trigger, then start a dev run from the pinned commit. The ref is
 * resolved on blur through `GET /definitions/at-ref`; invalid files cannot be
 * selected, integration-sourced triggers are disabled unless a fixed event
 * matches, and a `ref-moved` answer re-lists the files for confirmation.
 */
export function RunFromBranchDialog({
  projectId,
  open,
  onOpenChange,
  onRunCreated,
  fixedEvent,
}: RunFromBranchDialogProps) {
  const createDevRun = useCreateDevRunMutation();
  // Row ids come from an instance-scoped counter so they are stable across
  // edits and reset with each open, like the rest of the draft state.
  const inputRowId = useRef(0);

  function nextInputRowId(): number {
    inputRowId.current += 1;
    return inputRowId.current;
  }

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
    inputRowId.current = 0;
  }, [open]);

  const query = useDefinitionsAtRefQuery(projectId, open ? resolvedRef : undefined);
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

  // A trigger is selectable when it is not integration-sourced, unless a
  // fixed event is set, in which case only triggers whose source and event
  // match it are selectable (the replay entry point).
  function triggerIsSelectable(trigger: DefinitionAtRefTrigger): boolean {
    if (!fixedEvent) return runFromBranchTriggerKind(trigger.source) !== 'integration';
    if (trigger.source !== fixedEvent.source) return false;
    if (trigger.event !== undefined) return trigger.event === fixedEvent.event;
    // A trigger without an explicit event matches any event from its source:
    // an integration trigger replays a journaled event (a wildcard), while
    // built-in sources fall back to their dispatch event.
    if (runFromBranchTriggerKind(trigger.source) === 'integration') return true;
    return runFromBranchTriggerDefaultEvent(trigger.source) === fixedEvent.event;
  }

  // Cron triggers take no inputs, so the inputs step exists only for manual
  // triggers; for cron the trigger step is the last one and carries the submit.
  const visibleSteps =
    selectedTriggerKind === 'manual' ? RUN_FROM_BRANCH_STEPS : RUN_FROM_BRANCH_STEPS.slice(0, 3);
  const stepIndex = visibleSteps.findIndex((stepDef) => stepDef.id === step);

  function handleRefBlur() {
    if (refDraft.trim() === '') {
      setRefBlurredEmpty(true);
      // Clearing the ref invalidates the previous resolution: without a
      // listing the next step stays disabled, so a stale pinned commit
      // cannot be submitted from the old ref.
      setResolvedRef(undefined);
      setSelectedConfigPath(undefined);
      setSelectedTriggerKey(undefined);
      setInputRows([]);
      setRefMovedCopy(null);
      setSubmitError(null);
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

  const duplicateKeys = runFromBranchDuplicateKeys(inputRows);

  const canProceed =
    step === 'inputs'
      ? selectedTrigger !== undefined && duplicateKeys.length === 0
      : step === 'trigger'
        ? selectedTrigger !== undefined && triggerIsSelectable(selectedTrigger)
        : step === 'file'
          ? selectedConfigPath !== undefined && !query.isError
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
    setInputRows(
      runFromBranchInputsFromWith(trigger?.with).map((row) => ({id: nextInputRowId(), ...row})),
    );
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
      !selectedTrigger ||
      !triggerIsSelectable(selectedTrigger)
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
        replayEventId: fixedEvent?.id,
      });
      onOpenChange(false);
      onRunCreated?.(result.workflowRunId);
    } catch (error) {
      if (isErrorWithCode(error, 'ref-moved')) {
        // The mutation refreshed the at-ref listing before the POST, so the
        // dialog already observes the ref's current commit; refetching here
        // would only repeat that refresh. When the refresh failed, the stale
        // listing must not be presented as confirmable.
        setRefMovedCopy(devRunErrorCopy(error));
        setSelectedConfigPath(undefined);
        setSelectedTriggerKey(undefined);
        setInputRows([]);
        setStep('file');
        if (createDevRun.atRefRefreshFailed.current) {
          setSubmitError({
            title: 'Could not re-list the workflow files',
            message: 'The ref moved and the updated listing could not be loaded. Try again.',
          });
        }
        return;
      }
      setSubmitError(devRunErrorCopy(error));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        // A run in flight must not be dismissed: the success path would
        // otherwise navigate to the run detail from a dialog the user
        // already closed.
        if (createDevRun.isPending && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <ModalContent aria-describedby={undefined} className="max-w-[560px]">
        <ModalTitle className="sr-only">Run from branch</ModalTitle>
        <ModalHeader title="Run from branch" showClose={!createDevRun.isPending} />
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

              <div aria-live="polite" className="flex w-full flex-col gap-inline">
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
              </div>

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
                  {listing.files.map((file) =>
                    file.valid ? (
                      <RunFromBranchFileItem key={file.configPath} file={file} />
                    ) : (
                      <RunFromBranchInvalidFileCard key={file.configPath} file={file} />
                    ),
                  )}
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
                    const selectable = triggerIsSelectable(trigger);
                    return selectable ? (
                      <RadioGroupItem key={triggerKey} value={triggerKey}>
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
                          Event {trigger.event ?? runFromBranchTriggerDefaultEvent(trigger.source)}
                        </Text>
                        {kind === 'cron' ? (
                          <Text size="xs" className="text-foreground-neutral-muted">
                            This scheduled trigger fires now and may overlap the next scheduled run.
                          </Text>
                        ) : null}
                      </RadioGroupItem>
                    ) : (
                      <RunFromBranchUnavailableTriggerCard
                        key={triggerKey}
                        triggerKey={triggerKey}
                        kind={kind}
                        trigger={trigger}
                        hasFixedEvent={fixedEvent !== undefined}
                      />
                    );
                  })}
                </RadioGroup>
              )}
            </div>
          ) : null}

          {step === 'inputs' ? (
            <div className="flex w-full flex-col gap-group">
              {selectedTrigger && selectedTrigger.source === 'manual' ? (
                <>
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
                              onChange={(event) =>
                                updateInputRow(index, {value: event.target.value})
                              }
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
                  {duplicateKeys.length > 0 ? (
                    <Text size="xs" className="text-tag-error-text">
                      {`Duplicate input key${duplicateKeys.length === 1 ? '' : 's'}: ${duplicateKeys.join(', ')}. Each key must be unique.`}
                    </Text>
                  ) : null}
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setInputRows((rows) => [
                          ...rows,
                          {id: nextInputRowId(), key: '', value: ''},
                        ])
                      }
                    >
                      Add input
                    </Button>
                  </div>
                </>
              ) : (
                <Text size="sm" className="text-foreground-neutral-muted">
                  The selected trigger is no longer available at this ref.
                </Text>
              )}
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

function RunFromBranchFileItem({file}: {file: DefinitionAtRefFile}) {
  return (
    <RadioGroupItem value={file.configPath}>
      <div className="flex w-full items-center gap-inline">
        <Text size="sm" bold className="min-w-0 truncate">
          {file.name ?? 'Unnamed workflow'}
        </Text>
        {file.warnings.length > 0 ? <StatusBadge variant="warning">Warnings</StatusBadge> : null}
      </div>
      <Code className="truncate text-foreground-neutral-muted">{file.configPath}</Code>
      {file.warnings.length > 0 ? (
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

const DISABLED_FILE_SURFACE =
  'flex min-w-0 items-center gap-cluster rounded-8 border border-border-neutral-base bg-background-neutral-base px-row py-row text-left text-foreground-neutral-base shadow-button-neutral';

/**
 * An invalid file rendered outside the radio group: a disabled control would
 * drop the diagnostics from the accessibility tree, so the errors render in
 * a plain card that stays readable but cannot be selected.
 */
function RunFromBranchInvalidFileCard({file}: {file: DefinitionAtRefFile}) {
  return (
    <div className={cn(DISABLED_FILE_SURFACE, 'cursor-not-allowed')}>
      <span
        aria-hidden="true"
        className="flex size-16 shrink-0 items-center justify-center rounded-full border border-border-neutral-base"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex w-full items-center gap-inline">
          <Text size="sm" bold className="min-w-0 truncate">
            {file.name ?? 'Unnamed workflow'}
          </Text>
          <StatusBadge variant="error">Invalid</StatusBadge>
        </div>
        <Code className="truncate text-foreground-neutral-muted">{file.configPath}</Code>
        {file.errors.length > 0 ? (
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
      </div>
    </div>
  );
}

/**
 * A trigger that cannot be selected, rendered outside the radio group so the
 * unavailable-reason hint stays in the accessibility tree.
 */
function RunFromBranchUnavailableTriggerCard({
  triggerKey,
  kind,
  trigger,
  hasFixedEvent,
}: {
  triggerKey: string;
  kind: RunFromBranchTriggerKind;
  trigger: DefinitionAtRefTrigger;
  hasFixedEvent: boolean;
}) {
  return (
    <div className={cn(DISABLED_FILE_SURFACE, 'cursor-not-allowed')}>
      <span
        aria-hidden="true"
        className="flex size-16 shrink-0 items-center justify-center rounded-full border border-border-neutral-base"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex w-full items-center gap-inline">
          <Text size="sm" bold className="min-w-0 truncate">
            {triggerKey}
          </Text>
          <StatusBadge
            variant={kind === 'manual' ? 'info' : kind === 'cron' ? 'feature' : 'neutral'}
          >
            {runFromBranchTriggerSourceLabel(trigger.source)}
          </StatusBadge>
        </div>
        <Text size="xs" className="text-foreground-neutral-muted">
          Event {trigger.event ?? runFromBranchTriggerDefaultEvent(trigger.source)}
        </Text>
        <Text size="xs" className="text-tag-warning-text">
          {hasFixedEvent
            ? 'Does not match the selected event.'
            : 'Replay arrives in a later release.'}
        </Text>
      </div>
    </div>
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
  // When the selected trigger disappears mid-flow the current step can fall
  // outside the visible steps (index -1); clamp the live status so it never
  // announces "Step 0 of N".
  const clampedIndex = Math.min(Math.max(currentIndex, 0), steps.length - 1);
  return (
    <ol
      className="flex w-full flex-wrap items-center gap-inline"
      aria-label="Run from branch steps"
    >
      {steps.map((stepDef, index) => {
        const state =
          index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
        return (
          <li
            key={stepDef.id}
            className="flex min-w-0 items-center gap-inline"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {index > 0 ? (
              <span aria-hidden="true" className="h-px w-16 shrink-0 bg-border-neutral-base" />
            ) : null}
            <span
              className={cn(
                'flex items-center gap-tight text-xs',
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
      <li className="sr-only" aria-live="polite">
        Step {clampedIndex + 1} of {steps.length}: {steps[clampedIndex]?.label ?? ''}
      </li>
    </ol>
  );
}
