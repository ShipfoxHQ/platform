import {
  type MaterializedSecretBindingDto,
  materializedSecretBindingSchema,
  type StepSecretDto,
} from '@shipfox/api-secrets-dto';
import type {LogOutcomeDto, NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {redactSecrets} from '@shipfox/redact';
import {
  type CheckoutDestinations,
  type CommandStartMetadata,
  executeCheckoutStep,
  executeRunStep,
  executeSetupStep,
  type SetupJobContext,
  type StepResult,
} from '@shipfox/runner-execution';
import {
  buildSecretVariants,
  createSessionLogStream,
  createStepLogStream,
  type LogDrainOutcome,
  type LogStreamLifecycle,
  type SessionLogStream,
  type StepLogStream,
} from '@shipfox/runner-logs';
import {
  AgentRuntimeConfigRequestError,
  type AnnotationWriteOutcome,
  appendStepLogs,
  HTTPError,
  integrationToolsGatewayUrl,
  type LeaseTokenSource,
  type LogAppendFn,
  reportStep,
  requestAgentRuntimeConfig,
  requestNextStep,
  requestStepSecrets,
  StepSecretsRequestError,
  writeStepAnnotations,
} from '@shipfox/runner-protocol';
import {createJobLogsDir, resolveWorkingDirectory} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';

const WHITESPACE_REGEX = /\s+/;
export type RunnerAgentStepModule = typeof import('@shipfox/runner-agent/step');

export function createRunnerAgentStepLoader(
  importAgentStep: () => Promise<RunnerAgentStepModule> = () =>
    import('@shipfox/runner-agent/step'),
): () => Promise<RunnerAgentStepModule> {
  let runnerAgentStepModule: Promise<RunnerAgentStepModule> | undefined;

  return () => {
    if (runnerAgentStepModule !== undefined) return runnerAgentStepModule;

    const pending = importAgentStep().catch((error: unknown) => {
      runnerAgentStepModule = undefined;
      throw error;
    });
    runnerAgentStepModule = pending;
    return pending;
  };
}

const loadRunnerAgentStep = createRunnerAgentStepLoader();

// Reporting a step before pulling the next one is the safety invariant: a lost report is
// retried in place (next/report are idempotent), so a step is never re-pulled or
// re-executed. The per-attempt log stream is settled before that report so the server can
// close the durable stream immediately from the reported log outcome.
//
// Each step gets a per-attempt log stream: capture -> spool -> upload. The prior
// attempt's stream is drained and disposed before the report, and the `finally`
// drains an aborted last one (bounded) before runJob deletes the runner-owned spool directory.
export async function runJobSteps(params: {
  jobId: string;
  leaseClient: KyInstance;
  leaseToken: LeaseTokenSource;
  /** Secrets masked out of captured output before it reaches the spool. */
  secrets: string[];
  subscribeSecrets?: (subscriber: (secrets: string[]) => void) => () => void;
  signal: AbortSignal;
  cwd: string;
  gitConfigPath: string;
  logsDir: string;
  jobContext: SetupJobContext;
  onLeaseTokenAdopted?: (leaseToken: string) => void;
}): Promise<void> {
  const {jobId, leaseClient, secrets, signal, cwd, gitConfigPath, logsDir, jobContext} = params;

  // The setup step prepares the workspace; every run step assumes it ran. A run
  // step pulled before a successful setup is failed cleanly rather than spawned
  // against an unprepared cwd.
  let workspacePrepared = false;
  let logsPrepared = false;
  let ambientGitConfigPath: string | undefined;
  let ambientGitConfigSecrets: string[] = [];
  const checkoutDestinations: CheckoutDestinations = new Map();

  // The most recent step's stream, kept until the next
  // iteration settles it (or the finally does at job end). The step loop is sequential, so
  // at most one tail drains.
  let activeStream: LogStreamLifecycle | undefined;

  try {
    while (!signal.aborted) {
      // Idempotent cleanup for abort/error paths; the normal report path settles and clears
      // activeStream before the next iteration reaches this point.
      await settleStream({stream: activeStream, signal});
      activeStream = undefined;

      const pulled = await pullNextStep({leaseClient, jobId, signal});
      if (!pulled) return;
      if (signal.aborted) return;

      params.onLeaseTokenAdopted?.(pulled.leaseToken);
      const {step, attempt} = pulled;
      const stepLabel = step.name ?? `step #${step.position}`;
      logger().info(
        {jobId, stepId: step.id, stepName: step.name, position: step.position, attempt},
        `Running ${stepLabel}`,
      );

      const prepareLogs =
        step.type === 'setup' && !logsPrepared
          ? async () => {
              await createJobLogsDir(logsDir);
              logsPrepared = true;
            }
          : undefined;
      const execution = await executeStep({
        step,
        attempt,
        cwd,
        leaseClient,
        leaseToken: params.leaseToken,
        secrets,
        ...(params.subscribeSecrets ? {subscribeSecrets: params.subscribeSecrets} : {}),
        signal,
        workspacePrepared,
        checkoutDestinations,
        ambientGitConfigPath,
        ambientGitConfigSecrets,
        jobId,
        stepLabel,
        logsDir,
        jobContext,
        gitConfigPath,
        ...(prepareLogs ? {prepareLogs} : {}),
      });
      activeStream = execution.stream;
      if (execution.preparedWorkspace) workspacePrepared = true;
      if (execution.ambientGitConfigPath) ambientGitConfigPath = execution.ambientGitConfigPath;
      if (execution.ambientGitConfigSecrets) {
        ambientGitConfigSecrets = [
          ...new Set([...ambientGitConfigSecrets, ...execution.ambientGitConfigSecrets]),
        ];
      }
      if (execution.result.success && execution.result.checkout) {
        rememberCheckoutDestination(checkoutDestinations, execution.result.checkout);
      }

      if (signal.aborted) return;

      const logOutcome =
        (await settleStream({stream: activeStream, signal})) ?? execution.logOutcome ?? 'drained';
      activeStream = undefined;

      await publishStepAnnotations({
        leaseClient,
        step,
        attempt,
        annotations: execution.result.annotations,
        jobId,
        signal,
      });

      const {cancel} = await reportStepResult({
        leaseClient,
        step,
        attempt,
        result: execution.result,
        logOutcome,
        jobId,
        jobExecutionId: jobContext.jobExecutionId,
        stepLabel,
        signal,
      });
      if (cancel) {
        logger().info(
          {jobId, stepId: step.id},
          'Job finished without full success; stopping step loop',
        );
        return;
      }
    }
  } finally {
    // Drain the last stream (bounded) before runJob deletes the log spool; an abort
    // cuts the wait short. Whatever did not drain is timeout-closed server-side.
    await settleStream({stream: activeStream, signal});
  }
}

function rememberCheckoutDestination(
  destinations: CheckoutDestinations,
  checkout: NonNullable<StepResult['checkout']>,
): void {
  destinations.set(checkout.path, {
    repository: checkout.repository,
    ref: checkout.ref,
    result: checkout,
  });
}

export interface PulledStep {
  step: StepDto;
  attempt: number;
  leaseToken: string;
}

// Pulls the next step, translating the loop's two quiet stop conditions into `undefined`:
// a 404 (the lease no longer maps to a job) and a `done` response. Any other error
// propagates so the loop bails without re-pulling.
export async function pullNextStep(params: {
  leaseClient: KyInstance;
  jobId: string;
  signal: AbortSignal;
}): Promise<PulledStep | undefined> {
  const {leaseClient, jobId, signal} = params;

  let next: NextStepResponseDto;
  try {
    next = await requestNextStep(leaseClient, {signal});
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 404) {
      logger().info({jobId}, 'No job for this lease (404); stopping step loop');
      return undefined;
    }
    throw error;
  }

  if (next.kind === 'done') {
    logger().info({jobId, status: next.status}, 'No more steps; stopping step loop');
    return undefined;
  }

  return {step: next.step, attempt: next.attempt, leaseToken: next.lease_token};
}

export interface StepExecution {
  result: StepResult;
  stream?: LogStreamLifecycle | undefined;
  logOutcome?: LogOutcomeDto | undefined;
  /** True when a setup step succeeded, unlocking the run steps that follow it. */
  preparedWorkspace: boolean;
  ambientGitConfigPath?: string | undefined;
  ambientGitConfigSecrets?: string[] | undefined;
}

// Runs one step and always yields a StepResult, never throws: a crash before a result
// exists (e.g. writing the temp script) becomes a reported failure so the step does not
// hang `running`. The log stream is returned even on a
// throw, so the caller can still settle it.
export async function executeStep(params: {
  step: StepDto;
  attempt: number;
  cwd: string;
  logsDir: string;
  jobContext: SetupJobContext;
  leaseClient: KyInstance;
  leaseToken: LeaseTokenSource;
  secrets: string[];
  subscribeSecrets?: (subscriber: (secrets: string[]) => void) => () => void;
  signal: AbortSignal;
  workspacePrepared: boolean;
  checkoutDestinations?: CheckoutDestinations | undefined;
  ambientGitConfigPath?: string | undefined;
  ambientGitConfigSecrets?: string[] | undefined;
  gitConfigPath: string;
  jobId: string;
  stepLabel: string;
  prepareLogs?: (() => Promise<void>) | undefined;
}): Promise<StepExecution> {
  const {
    step,
    attempt,
    cwd,
    logsDir,
    jobContext,
    leaseClient,
    leaseToken,
    secrets,
    subscribeSecrets,
    signal,
    workspacePrepared,
    checkoutDestinations = new Map(),
    ambientGitConfigPath,
    ambientGitConfigSecrets = [],
    gitConfigPath,
    jobId,
    stepLabel,
    prepareLogs,
  } = params;

  let stream: LogStreamLifecycle | undefined;
  let runStream: StepLogStream | undefined;
  let unsubscribeSecrets: (() => void) | undefined;
  let crashSecretVariants = buildSecretVariants(secrets);
  const registerStreamSecrets = (
    target:
      | {
          addSecrets?: (secrets: string[]) => void;
          setRotatingSecrets?: (secrets: string[]) => void;
        }
      | undefined,
  ) => {
    if (!target?.setRotatingSecrets && !target?.addSecrets) return;
    unsubscribeSecrets = subscribeSecrets?.((registeredSecrets) => {
      if (target.setRotatingSecrets) {
        target.setRotatingSecrets(registeredSecrets);
        return;
      }
      target.addSecrets?.(registeredSecrets);
    });
  };
  try {
    // Both step kinds capture to the same per-attempt stream contract (one stream per
    // job/step/attempt). The append port is bound to the lease client, step, and attempt.
    const append: LogAppendFn = ({offset, body, signal: appendSignal}) =>
      appendStepLogs(leaseClient, {
        stepId: step.id,
        attempt,
        offset,
        body,
        ...(appendSignal ? {signal: appendSignal} : {}),
      });

    if (step.type === 'setup') {
      if (prepareLogs) {
        try {
          await prepareLogs();
        } catch (error) {
          const result = setupLogDirectoryFailure(error);
          logger().warn(
            {err: error, jobId, stepId: step.id, attempt, reason: result.error?.reason},
            'Setup step failed',
          );
          return {result, logOutcome: 'abandoned', preparedWorkspace: false};
        }
      }

      let setupStream: StepLogStream | undefined;
      try {
        setupStream = createStepLogStream({
          logsDir,
          stepId: step.id,
          attempt,
          secrets,
          append,
        });
      } catch (error) {
        logger().error(
          {err: error, jobId, stepId: step.id, attempt},
          'Failed to open setup log capture; running setup without it',
        );
      }
      stream = setupStream;
      registerStreamSecrets(setupStream);

      const setup = await executeSetupStep({
        cwd,
        gitConfigPath,
        leaseClient,
        signal,
        step,
        attempt,
        ...(setupStream ? {log: setupStream} : {}),
        jobContext,
      });
      return {
        result: setup.result,
        stream,
        logOutcome: setupStream ? undefined : 'abandoned',
        preparedWorkspace: setup.result.success,
        ...(setup.ambientGitConfigPath ? {ambientGitConfigPath: setup.ambientGitConfigPath} : {}),
        ...(setup.ambientGitConfigSecrets
          ? {ambientGitConfigSecrets: setup.ambientGitConfigSecrets}
          : {}),
      };
    }

    if (!workspacePrepared) {
      // Invariant violation (a run or agent step before setup prepared the cwd), not a
      // setup-phase failure, so no `reason`. step.type is not 'setup' so the server
      // derives category 'user'.
      return {
        result: {
          success: false,
          error: {message: 'Run step dispatched before setup prepared the workspace'},
          exit_code: null,
        },
        logOutcome: 'drained',
        preparedWorkspace: false,
      };
    }

    if (step.type === 'checkout') {
      let checkoutStream: StepLogStream | undefined;
      try {
        checkoutStream = createStepLogStream({
          logsDir,
          stepId: step.id,
          attempt,
          secrets,
          append,
        });
      } catch (error) {
        logger().error(
          {err: error, jobId, stepId: step.id, attempt},
          'Failed to open checkout log capture; running checkout without it',
        );
      }
      stream = checkoutStream;
      registerStreamSecrets(checkoutStream);

      const checkout = await executeCheckoutStep({
        cwd,
        gitConfigPath,
        leaseClient,
        signal,
        step,
        attempt,
        destinations: checkoutDestinations,
        ...(checkoutStream ? {log: checkoutStream} : {}),
      });
      return {
        result: checkout.result,
        stream,
        logOutcome: checkoutStream ? undefined : 'abandoned',
        preparedWorkspace: false,
        ...(checkout.ambientGitConfigPath
          ? {ambientGitConfigPath: checkout.ambientGitConfigPath}
          : {}),
        ...(checkout.ambientGitConfigSecrets
          ? {ambientGitConfigSecrets: checkout.ambientGitConfigSecrets}
          : {}),
      };
    }

    let stepCwd: string;
    try {
      stepCwd = await resolveWorkingDirectory(cwd, step.config.working_directory);
    } catch (error) {
      return {
        result: {
          success: false,
          error: {message: error instanceof Error ? error.message : String(error)},
          exit_code: null,
        },
        logOutcome: 'abandoned',
        preparedWorkspace: false,
      };
    }

    // Agent steps run the embedded pi harness and forward every session entry into the log
    // pipeline as opaque `agent_session` records. Capture is best-effort: if the spool cannot
    // be opened, run the agent without it rather than failing the step.
    if (step.type === 'agent') {
      let runtimeConfig: Awaited<ReturnType<typeof requestAgentRuntimeConfig>>;
      try {
        runtimeConfig = await requestAgentRuntimeConfig(leaseClient, {
          stepId: step.id,
          attempt,
          signal,
        });
      } catch (error) {
        return {
          result: agentRuntimeConfigFailure(error),
          logOutcome: 'drained',
          preparedWorkspace: false,
        };
      }

      let sessionStream: SessionLogStream | undefined;
      const runtimeCredentialValues = Object.values(runtimeConfig.credentials);
      const runtimeSecretVariants = buildSecretVariants(runtimeCredentialValues);
      const agentSecrets = [...secrets, ...runtimeCredentialValues];
      try {
        sessionStream = createSessionLogStream({
          logsDir,
          stepId: step.id,
          attempt,
          secrets: agentSecrets,
          append,
        });
      } catch (error) {
        logger().error(
          {err: error, jobId, stepId: step.id, attempt},
          'Failed to open agent session capture; running the step without it',
        );
      }
      stream = sessionStream;
      registerStreamSecrets(sessionStream);
      const {executeAgentStep} = await loadRunnerAgentStep();
      const result = await executeAgentStep(step, {
        signal,
        cwd: stepCwd,
        logsDir,
        ...(ambientGitConfigPath ? {gitConfigGlobal: ambientGitConfigPath} : {}),
        runtime: {
          harness: runtimeConfig.harness,
          provider: runtimeConfig.provider_id,
          model: runtimeConfig.model,
          thinking: runtimeConfig.thinking,
          credentials: runtimeConfig.credentials,
          ...(runtimeConfig.custom_provider
            ? {custom_provider: runtimeConfig.custom_provider}
            : {}),
        },
        leaseToken,
        integrationToolsGatewayUrl: integrationToolsGatewayUrl(),
        ...(sessionStream
          ? {onSessionEntry: (line: string) => sessionStream?.writeEntry(line)}
          : {}),
      });
      return {
        result: maskAgentResult(result, runtimeSecretVariants),
        stream,
        logOutcome: sessionStream ? undefined : 'abandoned',
        preparedWorkspace: false,
      };
    }

    let runSecretMaterial: RunSecretMaterial | undefined;
    try {
      runSecretMaterial = await loadRunSecretMaterial({step, leaseClient, attempt, signal});
    } catch (error) {
      return {
        result: stepSecretsFailure(error),
        logOutcome: 'drained',
        preparedWorkspace: false,
      };
    }

    // Log capture is best-effort: if the spool cannot be opened (e.g. a broken logs dir),
    // abandon capture and run the step without a stream rather than failing the step itself.
    let stepStream: StepLogStream | undefined;
    const runSecrets = [
      ...secrets,
      ...ambientGitConfigSecrets,
      ...(runSecretMaterial?.secretValues ?? []),
    ];
    const runSecretValues = [
      ...ambientGitConfigSecrets,
      ...(runSecretMaterial?.secretValues ?? []),
    ];
    const runSecretVariants = buildSecretVariants(runSecrets);
    crashSecretVariants = runSecretVariants;
    try {
      stepStream = createStepLogStream({
        logsDir,
        stepId: step.id,
        attempt,
        secrets: runSecrets,
        append,
      });
    } catch (error) {
      logger().error(
        {err: error, jobId, stepId: step.id, attempt},
        'Failed to open log capture; running the step without it',
      );
    }
    stream = stepStream;
    runStream = stepStream;
    registerStreamSecrets(stepStream);

    let result = await executeRunStep(step, {
      signal,
      cwd: stepCwd,
      workspace: cwd,
      ...(ambientGitConfigPath ? {gitConfigGlobal: ambientGitConfigPath} : {}),
      ...(runSecretMaterial?.secretEnv ? {secretEnv: runSecretMaterial.secretEnv} : {}),
      ...(runSecretValues.length > 0 ? {secretValues: runSecretValues} : {}),
      onCommandStart: (metadata) => writeCommandMetadata(stepStream, metadata),
      onOutput: (chunk, source) => stepStream?.write(chunk, source),
    });
    result = maskRunStepOutputs(result, runSecretVariants);
    writeRunFailureContext(stepStream, result);
    return {
      result,
      stream,
      logOutcome: stepStream ? undefined : 'abandoned',
      preparedWorkspace: false,
    };
  } catch (error) {
    logger().error(
      {err: error, jobId, stepId: step.id},
      `Step ${stepLabel} crashed before producing a result`,
    );
    const result: StepResult = {
      success: false,
      error: {
        message: redactSecrets(
          error instanceof Error ? error.message : String(error),
          crashSecretVariants,
        ),
      },
      exit_code: null,
    };
    writeRunFailureContext(runStream, result);
    return {
      result,
      stream,
      logOutcome: stream ? undefined : step.type === 'setup' ? 'drained' : 'abandoned',
      preparedWorkspace: false,
    };
  } finally {
    unsubscribeSecrets?.();
    runStream?.writeGroupEnd();
  }
}

interface RunSecretMaterial {
  secretEnv: Record<string, string>;
  secretValues: string[];
}

const runSecretBindingsSchema = materializedSecretBindingSchema.array();

async function loadRunSecretMaterial(params: {
  step: StepDto;
  leaseClient: KyInstance;
  attempt: number;
  signal: AbortSignal;
}): Promise<RunSecretMaterial | undefined> {
  if (params.step.type !== 'run') return undefined;
  const bindings = parseRunSecretBindings(params.step.config.secret_bindings);
  if (bindings.length === 0) return undefined;

  const pulled = await requestStepSecrets(params.leaseClient, {
    stepId: params.step.id,
    attempt: params.attempt,
    signal: params.signal,
  });
  const values = new Map(pulled.secrets.map((secret) => [secretReferenceId(secret), secret.value]));
  const secretEnv: Record<string, string> = {};

  for (const binding of bindings) {
    secretEnv[binding.target] = assembleSecretBinding(binding, values);
  }

  return {
    secretEnv,
    secretValues: pulled.secrets.map((secret) => secret.value),
  };
}

function parseRunSecretBindings(value: unknown): MaterializedSecretBindingDto[] {
  const parsed = runSecretBindingsSchema.safeParse(value ?? []);
  if (!parsed.success) throw new Error('Run step secret bindings are invalid.');
  return parsed.data;
}

function assembleSecretBinding(
  binding: MaterializedSecretBindingDto,
  values: ReadonlyMap<string, string>,
): string {
  return binding.segments
    .map((segment) => {
      if (segment.kind === 'literal') return segment.value;
      const value = values.get(secretReferenceId(segment));
      if (value === undefined) {
        throw new Error('Run step secret response is missing a requested secret.');
      }
      return value;
    })
    .join('');
}

function secretReferenceId(reference: Pick<StepSecretDto, 'store' | 'key'>): string {
  return `${reference.store}\0${reference.key}`;
}

function stepSecretsFailure(error: unknown): StepResult {
  if (error instanceof StepSecretsRequestError) {
    return {
      success: false,
      error: {message: error.message, reason: 'config_unresolvable'},
      exit_code: null,
    };
  }

  return {
    success: false,
    error: {
      message: error instanceof Error ? error.message : 'Run step secrets could not be resolved.',
      reason: 'config_unresolvable',
    },
    exit_code: null,
  };
}

function setupLogDirectoryFailure(error: unknown): StepResult {
  return {
    success: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      reason: 'workspace_prep_failed',
    },
    exit_code: null,
  };
}

function maskAgentResult(result: StepResult, secretVariants: string[]): StepResult {
  if (result.success) {
    return {
      ...result,
      ...(result.response === undefined
        ? {}
        : {response: redactSecrets(result.response, secretVariants)}),
      ...(result.outputs === undefined
        ? {}
        : {outputs: redactOutputValues(result.outputs, secretVariants)}),
    };
  }

  const error =
    result.error === null || result.error === undefined
      ? result.error
      : {...result.error, message: redactSecrets(result.error.message, secretVariants)};
  return {
    ...result,
    ...(result.response === undefined
      ? {}
      : {response: redactSecrets(result.response, secretVariants)}),
    error,
  };
}

function maskRunStepOutputs(result: StepResult, secretVariants: string[]): StepResult {
  const outputs =
    result.outputs === undefined
      ? result.outputs
      : redactOutputValues(result.outputs, secretVariants);
  const annotations = redactAnnotationBodies(result.annotations, secretVariants);
  const error =
    result.success || result.error === null || result.error === undefined
      ? result.error
      : {...result.error, message: redactSecrets(result.error.message, secretVariants)};
  return {
    ...result,
    ...(outputs === undefined ? {} : {outputs}),
    ...(annotations === undefined ? {} : {annotations}),
    error,
  };
}

function redactAnnotationBodies(
  annotations: StepResult['annotations'],
  secretVariants: string[],
): StepResult['annotations'] {
  if (annotations === undefined) return undefined;
  return annotations.map((annotation) => {
    if (annotation.op === 'remove') return annotation;
    return {...annotation, body: redactSecrets(annotation.body, secretVariants)};
  });
}

function redactOutputValues(
  outputs: Record<string, string>,
  secretVariants: string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [key, redactSecrets(value, secretVariants)]),
  );
}

function agentRuntimeConfigFailure(error: unknown): StepResult {
  if (error instanceof AgentRuntimeConfigRequestError) {
    const agentConfigIssue =
      error.agentConfigIssue ??
      (error.code === 'agent-config-invalid' ? 'step_config_invalid' : undefined);
    return {
      success: false,
      error: {
        message: error.message,
        reason: agentConfigIssue ? 'agent_config_invalid' : 'agent_invocation_failed',
        ...(agentConfigIssue ? {agent_config_issue: agentConfigIssue} : {}),
      },
      exit_code: null,
    };
  }

  return {
    success: false,
    error: {message: error instanceof Error ? error.message : String(error)},
    exit_code: null,
  };
}

export async function publishStepAnnotations(params: {
  leaseClient: KyInstance;
  step: StepDto;
  attempt: number;
  annotations: StepResult['annotations'];
  jobId: string;
  signal: AbortSignal;
}): Promise<void> {
  const annotations = params.annotations ?? [];
  if (annotations.length === 0) return;

  let outcome: AnnotationWriteOutcome;
  try {
    outcome = await writeStepAnnotations(params.leaseClient, {
      stepId: params.step.id,
      attempt: params.attempt,
      annotations,
      signal: params.signal,
    });
  } catch (error) {
    logger().warn(
      {err: error, jobId: params.jobId, stepId: params.step.id, attempt: params.attempt},
      'Failed to publish step annotations; continuing step report',
    );
    return;
  }

  if (outcome.status === 'written') return;

  logger().warn(
    {
      jobId: params.jobId,
      stepId: params.step.id,
      attempt: params.attempt,
      outcome,
    },
    'Step annotations were not written; continuing step report',
  );
}

function writeCommandMetadata(
  stream: StepLogStream | undefined,
  metadata: CommandStartMetadata,
): void {
  stream?.writeGroup({
    name: `Run ${summarizeCommand(metadata.command)}`,
    lines: [
      metadata.command,
      `shell: ${metadata.shell.display}`,
      ...(metadata.cwd !== undefined ? [`working-directory: ${metadata.cwd}`] : []),
    ],
    source: 'stdout',
  });
}

function writeRunFailureContext(stream: StepLogStream | undefined, result: StepResult): void {
  if (result.success) return;
  stream?.writeOutputLine(runFailureContext(result), 'stderr');
}

function runFailureContext(result: StepResult): string {
  if (result.error?.signal) return `Process terminated by signal ${result.error.signal}.`;
  if (result.exit_code !== null) return `Process completed with exit code ${result.exit_code}.`;
  if (result.error?.message) return `Process failed: ${result.error.message}`;
  return 'Process failed.';
}

function summarizeCommand(command: string): string {
  const summary = command.trim().split(WHITESPACE_REGEX).join(' ');
  if (summary.length <= 120) return summary;
  return `${summary.slice(0, 117)}...`;
}

// Logs the outcome, seals the stream to learn its declared length, and reports the step.
// Returns whether the server asked the loop to stop (job finished without full success).
export async function reportStepResult(params: {
  leaseClient: KyInstance;
  step: StepDto;
  attempt: number;
  result: StepResult;
  logOutcome: LogOutcomeDto;
  jobId: string;
  jobExecutionId: string;
  stepLabel: string;
  signal: AbortSignal;
}): Promise<{cancel: boolean}> {
  const {leaseClient, step, attempt, result, logOutcome, jobId, jobExecutionId, stepLabel, signal} =
    params;

  if (result.success) {
    logger().info(
      {jobId, jobExecutionId, stepId: step.id, stepName: step.name, attempt},
      `Step ${stepLabel} succeeded`,
    );
  } else {
    logger().error(
      {
        jobId,
        jobExecutionId,
        stepId: step.id,
        stepName: step.name,
        attempt,
        reason: result.error?.reason,
        ...(result.error?.agent_config_issue
          ? {agentConfigIssue: result.error.agent_config_issue}
          : {}),
        ...(result.error?.message ? {message: result.error.message.slice(0, 200)} : {}),
      },
      `Step ${stepLabel} failed`,
    );
  }

  const report = await reportStep(leaseClient, {
    stepId: step.id,
    attempt,
    status: result.success ? 'succeeded' : 'failed',
    // null on success, the error shape on failure: matches reportStepBodySchema's refine.
    error: result.error,
    exitCode: result.exit_code,
    ...(result.response === undefined ? {} : {response: result.response}),
    ...(result.outputs ? {outputs: result.outputs} : {}),
    ...(result.checkout === undefined ? {} : {checkout: result.checkout}),
    logOutcome,
    signal,
  });

  return {cancel: report.cancel};
}

// Closes (idempotent), drains (bounded; an abort cuts it short), and disposes a stream.
// A no-op when there is no stream, so callers can settle unconditionally.
export async function settleStream(params: {
  stream: LogStreamLifecycle | undefined;
  signal: AbortSignal;
}): Promise<LogDrainOutcome | undefined> {
  const {stream, signal} = params;
  if (!stream) return undefined;
  await stream.close();
  const outcome = await stream.drain({signal});
  stream.dispose();
  return outcome;
}
