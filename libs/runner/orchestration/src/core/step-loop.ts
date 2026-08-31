import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {gunzip, gzip} from 'node:zlib';
import {
  type MaterializedSecretBindingDto,
  materializedSecretBindingSchema,
  type StepSecretDto,
} from '@shipfox/api-secrets-dto';
import type {
  LogOutcomeDto,
  NextStepResponseDto,
  StepDto,
  StepErrorReasonDto,
} from '@shipfox/api-workflows-dto';
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
  commitSessionTranscript,
  HTTPError,
  integrationToolsGatewayUrl,
  type LeaseTokenSource,
  type LogAppendFn,
  reportStep,
  requestAgentRuntimeConfig,
  requestNextStep,
  requestSessionTranscript,
  requestStepSecrets,
  StepSecretsRequestError,
  writeStepAnnotations,
} from '@shipfox/runner-protocol';
import {createJobLogsDir, resolveWorkingDirectory} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

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
// close the durable stream immediately from the reported log outcome. A completed session
// commit is the boundary after which an abort still reports the attempt.
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
  registerSecrets?: (secrets: string[]) => void;
  signal: AbortSignal;
  cwd: string;
  gitConfigPath: string;
  logsDir: string;
  agentStateDir: string;
  prepareAgentState?: () => Promise<void>;
  jobContext: SetupJobContext;
  onLeaseTokenAdopted?: (leaseToken: string) => void;
}): Promise<void> {
  const {signal} = params;

  // The setup step prepares the workspace; every run step assumes it ran. A run
  // step pulled before a successful setup is failed cleanly rather than spawned
  // against an unprepared cwd.
  const state: JobStepLoopState = {
    workspacePrepared: false,
    logsPrepared: false,
    agentStatePrepared: false,
    ambientGitConfigPath: undefined,
    ambientGitConfigSecrets: [],
    checkoutDestinations: new Map(),
    activeStream: undefined,
    checkoutRef: undefined,
  };

  try {
    while (!signal.aborted) {
      const outcome = await runJobStepIteration(params, state);
      if (outcome === 'stop') return;
    }
  } finally {
    // Drain the last stream (bounded) before runJob deletes the log spool; an abort
    // cuts the wait short. Whatever did not drain is timeout-closed server-side.
    await settleStream({stream: state.activeStream, signal});
  }
}

interface JobStepLoopState {
  workspacePrepared: boolean;
  logsPrepared: boolean;
  agentStatePrepared: boolean;
  ambientGitConfigPath: string | undefined;
  ambientGitConfigSecrets: string[];
  checkoutDestinations: CheckoutDestinations;
  activeStream: LogStreamLifecycle | undefined;
  checkoutRef: string | undefined;
}

async function runJobStepIteration(
  params: Parameters<typeof runJobSteps>[0],
  state: JobStepLoopState,
): Promise<'continue' | 'stop'> {
  await settleStream({stream: state.activeStream, signal: params.signal});
  state.activeStream = undefined;
  const pulled = await pullNextStep({
    leaseClient: params.leaseClient,
    jobId: params.jobId,
    signal: params.signal,
  });
  if (!pulled || params.signal.aborted) return 'stop';
  params.onLeaseTokenAdopted?.(pulled.leaseToken);
  const {step, attempt} = pulled;
  const stepLabel = step.name ?? `step #${step.position}`;
  logger().info(
    {
      jobId: params.jobId,
      stepId: step.id,
      stepName: step.name,
      position: step.position,
      attempt,
    },
    `Running ${stepLabel}`,
  );
  const preparation = stepPreparation(params, state, step);
  const execution = await executeStep({
    step,
    attempt,
    cwd: params.cwd,
    agentStateDir: params.agentStateDir,
    leaseClient: params.leaseClient,
    leaseToken: params.leaseToken,
    secrets: params.secrets,
    ...(params.subscribeSecrets ? {subscribeSecrets: params.subscribeSecrets} : {}),
    signal: params.signal,
    workspacePrepared: state.workspacePrepared,
    checkoutDestinations: state.checkoutDestinations,
    ambientGitConfigPath: state.ambientGitConfigPath,
    ambientGitConfigSecrets: state.ambientGitConfigSecrets,
    checkoutRef: state.checkoutRef,
    jobId: params.jobId,
    stepLabel,
    logsDir: params.logsDir,
    jobContext: params.jobContext,
    gitConfigPath: params.gitConfigPath,
    ...preparation,
  });
  applyStepExecutionState(params, state, execution);
  if (params.signal.aborted) return 'stop';
  return finishStepExecution(params, state, step, attempt, stepLabel, execution);
}

function stepPreparation(
  params: Parameters<typeof runJobSteps>[0],
  state: JobStepLoopState,
  step: StepDto,
): Pick<Parameters<typeof executeStep>[0], 'prepareLogs' | 'prepareAgentState'> {
  const prepareLogs =
    step.type === 'setup' && !state.logsPrepared
      ? async () => {
          await createJobLogsDir(params.logsDir);
          state.logsPrepared = true;
        }
      : undefined;
  const prepareAgentState =
    step.type === 'setup' && !state.agentStatePrepared && params.prepareAgentState !== undefined
      ? async () => {
          await params.prepareAgentState?.();
          state.agentStatePrepared = true;
        }
      : undefined;
  return {
    ...(prepareLogs ? {prepareLogs} : {}),
    ...(prepareAgentState ? {prepareAgentState} : {}),
  };
}

function applyStepExecutionState(
  params: Parameters<typeof runJobSteps>[0],
  state: JobStepLoopState,
  execution: StepExecution,
): void {
  state.activeStream = execution.stream;
  if (execution.preparedWorkspace) state.workspacePrepared = true;
  if (execution.ambientGitConfigPath) state.ambientGitConfigPath = execution.ambientGitConfigPath;
  if (execution.ambientGitConfigSecrets) {
    params.registerSecrets?.(execution.ambientGitConfigSecrets);
    state.ambientGitConfigSecrets = [
      ...new Set([...state.ambientGitConfigSecrets, ...execution.ambientGitConfigSecrets]),
    ];
  }
  if (execution.result.success && execution.result.checkout) {
    rememberCheckoutDestination(state.checkoutDestinations, execution.result.checkout);
    state.checkoutRef = execution.result.checkout.ref;
  }
}

async function finishStepExecution(
  params: Parameters<typeof runJobSteps>[0],
  state: JobStepLoopState,
  step: StepDto,
  attempt: number,
  stepLabel: string,
  execution: StepExecution,
): Promise<'continue' | 'stop'> {
  const logOutcome =
    (await settleStream({stream: state.activeStream, signal: params.signal})) ??
    execution.logOutcome ??
    'drained';
  state.activeStream = undefined;
  if (params.signal.aborted) return 'stop';
  const settlement = await settleAgentSessionCommit({
    execution,
    leaseClient: params.leaseClient,
    step,
    attempt,
    signal: params.signal,
  });
  // Once the transcript commit has completed, reporting is the durable boundary:
  // an abort must not leave a committed attempt invisible to the API.
  if (params.signal.aborted && !settlement.committed) return 'stop';
  const reportSignal =
    params.signal.aborted && settlement.committed ? new AbortController().signal : params.signal;
  const {result} = settlement;
  await publishStepAnnotations({
    leaseClient: params.leaseClient,
    step,
    attempt,
    annotations: result.annotations,
    jobId: params.jobId,
    signal: reportSignal,
  });
  const {cancel} = await reportStepResult({
    leaseClient: params.leaseClient,
    step,
    attempt,
    result,
    logOutcome,
    jobId: params.jobId,
    jobExecutionId: params.jobContext.jobExecutionId,
    stepLabel,
    signal: reportSignal,
  });
  if (!cancel) return 'continue';
  logger().info(
    {jobId: params.jobId, stepId: step.id},
    'Job finished without full success; stopping step loop',
  );
  return 'stop';
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
  sessionCommit?: AgentSessionCommitContext | undefined;
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
  agentStateDir: string;
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
  checkoutRef?: string | undefined;
  gitConfigPath: string;
  jobId: string;
  stepLabel: string;
  prepareLogs?: (() => Promise<void>) | undefined;
  prepareAgentState?: (() => Promise<void>) | undefined;
}): Promise<StepExecution> {
  const {
    step,
    attempt,
    cwd,
    checkoutRef,
    leaseClient,
    secrets,
    subscribeSecrets,
    workspacePrepared,
    jobId,
    stepLabel,
  } = params;

  let stream: LogStreamLifecycle | undefined;
  let runStream: StepLogStream | undefined;
  const unsubscribeSecrets: Array<() => void> = [];
  const secretState = {
    subscribedSecrets: [...secrets],
    crashSecretVariants: buildSecretVariants(secrets),
  };
  const registerStreamSecrets = createStreamSecretRegistrar({
    subscribeSecrets,
    secretState,
    unsubscribeSecrets,
  });
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
      const execution = await executeSetupStepBranch({
        params: {...params, step},
        append,
        onStream: (createdStream) => {
          stream = createdStream;
        },
        registerStreamSecrets,
      });
      stream = execution.stream;
      return execution;
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
      const execution = await executeCheckoutStepBranch({
        params: {...params, step},
        append,
        onStream: (createdStream) => {
          stream = createdStream;
        },
        registerStreamSecrets,
      });
      stream = execution.stream;
      return execution;
    }

    const workingDirectory = await resolveStepWorkingDirectory(cwd, step.config.working_directory);
    if (!workingDirectory.ok) return workingDirectory.execution;
    const stepCwd = workingDirectory.path;

    // Agent steps run the embedded pi harness and forward every session entry into the log
    // pipeline as opaque `agent_session` records. Capture is best-effort: if the spool cannot
    // be opened, run the agent without it rather than failing the step.
    if (step.type === 'agent') {
      const execution = await executeAgentStepBranch({
        params: {...params, step},
        stepCwd,
        append,
        onStream: (createdStream) => {
          stream = createdStream;
        },
        registerStreamSecrets,
        secretState,
        checkoutRef,
      });
      stream = execution.stream;
      return execution;
    }

    const execution = await executeRunStepBranch({
      params: {...params, step},
      stepCwd,
      append,
      onStream: (createdStream) => {
        stream = createdStream;
        runStream = createdStream;
      },
      registerStreamSecrets,
      secretState,
    });
    stream = execution.stream;
    runStream = execution.stream as StepLogStream | undefined;
    return execution;
  } catch (error) {
    return crashedStepExecution({
      error,
      jobId,
      step,
      stepLabel,
      stream,
      runStream,
      secretState,
      secrets,
    });
  } finally {
    for (const unsubscribe of unsubscribeSecrets) unsubscribe();
    runStream?.writeGroupEnd();
  }
}

async function resolveStepWorkingDirectory(
  cwd: string,
  configured: unknown,
): Promise<{ok: true; path: string} | {ok: false; execution: StepExecution}> {
  try {
    return {ok: true, path: await resolveWorkingDirectory(cwd, configured)};
  } catch (error) {
    return {
      ok: false,
      execution: {
        result: {
          success: false,
          error: {message: error instanceof Error ? error.message : String(error)},
          exit_code: null,
        },
        logOutcome: 'abandoned',
        preparedWorkspace: false,
      },
    };
  }
}

function crashedStepExecution(params: {
  error: unknown;
  jobId: string;
  step: StepDto;
  stepLabel: string;
  stream: LogStreamLifecycle | undefined;
  runStream: StepLogStream | undefined;
  secretState: StepSecretState;
  secrets: string[];
}): StepExecution {
  logger().error(
    {err: params.error, jobId: params.jobId, stepId: params.step.id},
    `Step ${params.stepLabel} crashed before producing a result`,
  );
  const result: StepResult = {
    success: false,
    error: {
      message: redactSecrets(
        params.error instanceof Error ? params.error.message : String(params.error),
        buildSecretVariants([
          ...params.secretState.crashSecretVariants,
          ...params.secretState.subscribedSecrets,
          ...params.secrets,
        ]),
      ),
    },
    exit_code: null,
  };
  writeRunFailureContext(params.runStream, result);
  let logOutcome: LogOutcomeDto | undefined;
  if (!params.stream) logOutcome = params.step.type === 'setup' ? 'drained' : 'abandoned';
  return {result, stream: params.stream, logOutcome, preparedWorkspace: false};
}

type SecretAwareStream =
  | {
      addSecrets?: (secrets: string[]) => void;
      setSecrets?: (secrets: string[]) => void;
      setRotatingSecrets?: (secrets: string[]) => void;
    }
  | undefined;

function createStreamSecretRegistrar(params: {
  subscribeSecrets: Parameters<typeof executeStep>[0]['subscribeSecrets'];
  secretState: StepSecretState;
  unsubscribeSecrets: Array<() => void>;
}): (target: SecretAwareStream) => void {
  return (target) => {
    if (!target?.setSecrets && !target?.setRotatingSecrets && !target?.addSecrets) return;
    const unsubscribe = params.subscribeSecrets?.((registeredSecrets) => {
      params.secretState.subscribedSecrets = [
        ...new Set([...params.secretState.subscribedSecrets, ...registeredSecrets]),
      ];
      if (target.setSecrets) {
        target.setSecrets(registeredSecrets);
        return;
      }
      if (target.setRotatingSecrets) {
        target.setRotatingSecrets(registeredSecrets);
        return;
      }
      target.addSecrets?.(registeredSecrets);
    });
    if (unsubscribe) params.unsubscribeSecrets.push(unsubscribe);
  };
}

async function executeSetupStepBranch(params: {
  params: Parameters<typeof executeStep>[0];
  append: LogAppendFn;
  onStream: (stream: StepLogStream | undefined) => void;
  registerStreamSecrets: (stream: StepLogStream | undefined) => void;
}): Promise<StepExecution> {
  const input = params.params;
  const logFailure = await runSetupPreparations(input);
  if (logFailure) return logFailure;
  let setupStream: StepLogStream | undefined;
  try {
    setupStream = createStepLogStream({
      logsDir: input.logsDir,
      stepId: input.step.id,
      attempt: input.attempt,
      secrets: input.secrets,
      append: params.append,
    });
  } catch (error) {
    logger().error(
      {err: error, jobId: input.jobId, stepId: input.step.id, attempt: input.attempt},
      'Failed to open setup log capture; running setup without it',
    );
  }
  params.onStream(setupStream);
  params.registerStreamSecrets(setupStream);
  const setup = await executeSetupStep({
    cwd: input.cwd,
    gitConfigPath: input.gitConfigPath,
    leaseClient: input.leaseClient,
    signal: input.signal,
    step: input.step,
    attempt: input.attempt,
    ...(setupStream ? {log: setupStream} : {}),
    jobContext: input.jobContext,
  });
  return {
    result: setup.result,
    stream: setupStream,
    logOutcome: setupStream ? undefined : 'abandoned',
    preparedWorkspace: setup.result.success,
    ...(setup.ambientGitConfigPath ? {ambientGitConfigPath: setup.ambientGitConfigPath} : {}),
    ...(setup.ambientGitConfigSecrets
      ? {ambientGitConfigSecrets: setup.ambientGitConfigSecrets}
      : {}),
  };
}

async function executeCheckoutStepBranch(params: {
  params: Parameters<typeof executeStep>[0];
  append: LogAppendFn;
  onStream: (stream: StepLogStream | undefined) => void;
  registerStreamSecrets: (stream: StepLogStream | undefined) => void;
}): Promise<StepExecution> {
  const input = params.params;
  let checkoutStream: StepLogStream | undefined;
  try {
    checkoutStream = createStepLogStream({
      logsDir: input.logsDir,
      stepId: input.step.id,
      attempt: input.attempt,
      secrets: input.secrets,
      append: params.append,
    });
  } catch (error) {
    logger().error(
      {err: error, jobId: input.jobId, stepId: input.step.id, attempt: input.attempt},
      'Failed to open checkout log capture; running checkout without it',
    );
  }
  params.onStream(checkoutStream);
  params.registerStreamSecrets(checkoutStream);
  const checkout = await executeCheckoutStep({
    cwd: input.cwd,
    gitConfigPath: input.gitConfigPath,
    leaseClient: input.leaseClient,
    signal: input.signal,
    step: input.step,
    attempt: input.attempt,
    destinations: input.checkoutDestinations ?? new Map(),
    ...(checkoutStream ? {log: checkoutStream} : {}),
  });
  return {
    result: checkout.result,
    stream: checkoutStream,
    logOutcome: checkoutStream ? undefined : 'abandoned',
    preparedWorkspace: false,
    ...(checkout.ambientGitConfigPath ? {ambientGitConfigPath: checkout.ambientGitConfigPath} : {}),
    ...(checkout.ambientGitConfigSecrets
      ? {ambientGitConfigSecrets: checkout.ambientGitConfigSecrets}
      : {}),
  };
}

interface StepSecretState {
  subscribedSecrets: string[];
  crashSecretVariants: string[];
}

async function executeAgentStepBranch(params: {
  params: Parameters<typeof executeStep>[0];
  stepCwd: string;
  append: LogAppendFn;
  onStream: (stream: SessionLogStream | undefined) => void;
  registerStreamSecrets: (stream: SessionLogStream | undefined) => void;
  secretState: StepSecretState;
  checkoutRef?: string | undefined;
}): Promise<StepExecution> {
  const input = params.params;
  let runtimeConfig: Awaited<ReturnType<typeof requestAgentRuntimeConfig>>;
  try {
    runtimeConfig = await requestAgentRuntimeConfig(input.leaseClient, {
      stepId: input.step.id,
      attempt: input.attempt,
      signal: input.signal,
    });
  } catch (error) {
    return {
      result: agentRuntimeConfigFailure(error),
      logOutcome: 'drained',
      preparedWorkspace: false,
    };
  }
  let session: AgentSessionState;
  try {
    session = await prepareAgentSession(input, runtimeConfig);
  } catch (error) {
    return {
      result: agentSessionUnavailableFailure(error),
      logOutcome: 'drained',
      preparedWorkspace: false,
    };
  }
  const runtimeSecretValues = [
    ...Object.values(runtimeConfig.credentials),
    ...(runtimeConfig.claude !== undefined ? [runtimeConfig.claude.auth_token] : []),
  ];
  const agentSecrets = [...input.secrets, ...runtimeSecretValues];
  params.secretState.crashSecretVariants = buildSecretVariants(agentSecrets);
  const sessionStream = createAgentSessionLogStream(input, agentSecrets, params.append);
  params.onStream(sessionStream);
  params.registerStreamSecrets(sessionStream);
  const {executeAgentStep} = await loadRunnerAgentStep();
  const result = await executeAgentStep(input.step, {
    signal: input.signal,
    cwd: params.stepCwd,
    agentStateDir: input.agentStateDir,
    ...(session.invocation === undefined ? {} : {session: session.invocation}),
    ...(session.preamble && typeof input.step.config.prompt === 'string'
      ? {
          prompt: `${resumePreamble(session, params.checkoutRef)}\n\n${input.step.config.prompt}`,
        }
      : {}),
    ...(input.ambientGitConfigPath ? {gitConfigGlobal: input.ambientGitConfigPath} : {}),
    runtime: {
      harness: runtimeConfig.harness,
      provider: runtimeConfig.provider_id,
      model: runtimeConfig.model,
      thinking: runtimeConfig.thinking,
      credentials: runtimeConfig.credentials,
      ...(runtimeConfig.custom_provider ? {custom_provider: runtimeConfig.custom_provider} : {}),
      ...(runtimeConfig.claude !== undefined ? {claude: runtimeConfig.claude} : {}),
    },
    leaseToken: input.leaseToken,
    integrationToolsGatewayUrl: integrationToolsGatewayUrl(),
    ...(sessionStream ? {onSessionEntry: (line: string) => sessionStream.writeEntry(line)} : {}),
  });
  return {
    sessionCommit:
      runtimeConfig.harness === 'pi' &&
      session.mode === 'resume' &&
      session.baseSegment !== undefined
        ? {
            baseSegment: session.baseSegment,
            harness: runtimeConfig.harness,
            model: runtimeConfig.model,
            provider: runtimeConfig.provider_id,
          }
        : undefined,
    result: maskAgentResult(
      result,
      buildSecretVariants([
        ...agentSecrets,
        ...params.secretState.subscribedSecrets,
        ...input.secrets,
      ]),
    ),
    stream: sessionStream,
    logOutcome: sessionStream ? undefined : 'abandoned',
    preparedWorkspace: false,
  };
}

interface AgentSessionState {
  key?: string;
  mode?: 'resume' | 'fork';
  baseSegment?: number;
  invocation?: {
    mode: 'resume' | 'fork';
    file?: string;
    harnessSessionId?: string;
  };
  preamble: boolean;
}

class AgentSessionHarnessMismatchError extends Error {
  readonly reason = 'agent_session_harness_mismatch' as const;

  constructor(transcriptHarness: string, runtimeHarness: string) {
    super(
      `Session transcript belongs to harness "${transcriptHarness}", but this step uses "${runtimeHarness}"`,
    );
    this.name = 'AgentSessionHarnessMismatchError';
  }
}

interface AgentSessionCommitContext {
  readonly baseSegment: number;
  readonly harness: string;
  readonly model: string;
  readonly provider: string;
}

async function prepareAgentSession(
  input: Parameters<typeof executeStep>[0],
  runtimeConfig: Awaited<ReturnType<typeof requestAgentRuntimeConfig>>,
): Promise<AgentSessionState> {
  const descriptor = input.step.session === undefined ? runtimeConfig.session : input.step.session;
  if (descriptor === undefined || descriptor === null || runtimeConfig.harness !== 'pi') {
    return {preamble: false};
  }
  const transcript = await requestSessionTranscript(input.leaseClient, {
    stepId: input.step.id,
    attempt: input.attempt,
    signal: input.signal,
  });
  if (transcript.blob === null) {
    return {
      key: descriptor.key,
      mode: descriptor.mode,
      baseSegment: transcript.segment,
      invocation: {mode: descriptor.mode},
      preamble: false,
    };
  }
  if (transcript.harness !== undefined && transcript.harness !== runtimeConfig.harness) {
    throw new AgentSessionHarnessMismatchError(transcript.harness, runtimeConfig.harness);
  }
  const file = join(input.agentStateDir, 'sessions', `${descriptor.id}.jsonl`);
  await mkdir(join(input.agentStateDir, 'sessions'), {recursive: true});
  await writeFile(file, await gunzipAsync(transcript.blob));
  return {
    key: descriptor.key,
    mode: descriptor.mode,
    baseSegment: transcript.segment,
    invocation: {
      mode: descriptor.mode,
      file,
      ...(transcript.harnessSessionId === undefined
        ? {}
        : {harnessSessionId: transcript.harnessSessionId}),
    },
    preamble: descriptor.mode === 'resume',
  };
}

function resumePreamble(session: AgentSessionState, checkoutRef: string | undefined): string {
  const workspace =
    checkoutRef === undefined
      ? ''
      : ` This is a new execution in a fresh workspace checked out at ${checkoutRef}.`;
  return `Resuming session "${session.key ?? ''}".${workspace} Files and processes from earlier parts of this conversation no longer exist unless they were committed.`;
}

async function settleAgentSessionCommit(params: {
  execution: StepExecution;
  leaseClient: KyInstance;
  step: StepDto;
  attempt: number;
  signal: AbortSignal;
}): Promise<{result: StepResult; committed: boolean}> {
  const {execution, leaseClient, step, attempt, signal} = params;
  const commit = execution.sessionCommit;
  if (commit === undefined) return {result: execution.result, committed: false};

  if (execution.result.sessionFile === undefined) {
    if (!execution.result.success) return {result: execution.result, committed: false};
    return {
      result: agentSessionUnavailableFailure(
        new Error('Harness did not produce a session transcript'),
      ),
      committed: false,
    };
  }

  try {
    const transcriptBlob = await gzipAsync(await readFile(execution.result.sessionFile));
    if (signal.aborted) return {result: execution.result, committed: false};
    const outcome = await commitSessionTranscript(leaseClient, {
      stepId: step.id,
      attempt,
      baseSegment: commit.baseSegment,
      blob: transcriptBlob,
      harness: commit.harness,
      model: commit.model,
      provider: commit.provider,
      sdkVersion: 'pi-coding-agent',
      ...(execution.result.sessionId === undefined
        ? {}
        : {harnessSessionId: execution.result.sessionId}),
      signal,
    });
    if (outcome.status === 'conflict') {
      logger().error(
        {
          event: 'runner.agent_session_commit_conflict',
          stepId: step.id,
          attempt,
          baseSegment: commit.baseSegment,
          headSegment: outcome.headSegment,
        },
        'Agent session commit conflicted after the step completed',
      );
      return {result: execution.result, committed: false};
    }
    return {result: execution.result, committed: true};
  } catch (error) {
    logger().error(
      {
        event: 'runner.agent_session_persistence_failed',
        err: error,
        stepId: step.id,
        attempt,
        baseSegment: commit.baseSegment,
      },
      'Agent session persistence failed after the step completed',
    );
    return {result: execution.result, committed: false};
  }
}

function agentSessionUnavailableFailure(error: unknown): StepResult {
  const reason =
    error instanceof AgentSessionHarnessMismatchError
      ? error.reason
      : ('agent_session_unavailable' as const);
  return {
    success: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      reason,
    },
    exit_code: null,
  };
}

function createAgentSessionLogStream(
  input: Pick<Parameters<typeof executeStep>[0], 'logsDir' | 'step' | 'attempt' | 'jobId'>,
  secrets: string[],
  append: LogAppendFn,
): SessionLogStream | undefined {
  try {
    return createSessionLogStream({
      logsDir: input.logsDir,
      stepId: input.step.id,
      attempt: input.attempt,
      secrets,
      append,
    });
  } catch (error) {
    logger().error(
      {err: error, jobId: input.jobId, stepId: input.step.id, attempt: input.attempt},
      'Failed to open agent session capture; running the step without it',
    );
    return undefined;
  }
}

async function executeRunStepBranch(params: {
  params: Parameters<typeof executeStep>[0];
  stepCwd: string;
  append: LogAppendFn;
  onStream: (stream: StepLogStream | undefined) => void;
  registerStreamSecrets: (stream: StepLogStream | undefined) => void;
  secretState: StepSecretState;
}): Promise<StepExecution> {
  const input = params.params;
  let secretMaterial: RunSecretMaterial | undefined;
  try {
    secretMaterial = await loadRunSecretMaterial({
      step: input.step,
      leaseClient: input.leaseClient,
      attempt: input.attempt,
      signal: input.signal,
    });
  } catch (error) {
    return {
      result: stepSecretsFailure(error),
      logOutcome: 'drained',
      preparedWorkspace: false,
    };
  }
  const runSecrets = [
    ...input.secrets,
    ...(input.ambientGitConfigSecrets ?? []),
    ...(secretMaterial?.secretValues ?? []),
  ];
  params.secretState.crashSecretVariants = buildSecretVariants(runSecrets);
  const stepStream = createRunStepLogStream(input, runSecrets, params.append);
  params.onStream(stepStream);
  params.registerStreamSecrets(stepStream);
  let result = await executeRunStep(input.step, {
    signal: input.signal,
    cwd: params.stepCwd,
    workspace: input.cwd,
    ...(input.ambientGitConfigPath ? {gitConfigGlobal: input.ambientGitConfigPath} : {}),
    ...(secretMaterial?.secretEnv ? {secretEnv: secretMaterial.secretEnv} : {}),
    ...(runSecrets.length > 0 ? {secretValues: [...runSecrets]} : {}),
    ...(input.subscribeSecrets ? {subscribeSecrets: input.subscribeSecrets} : {}),
    onCommandStart: (metadata) => writeCommandMetadata(stepStream, metadata),
    onOutput: (chunk, source) => stepStream?.write(chunk, source),
  });
  result = maskRunStepOutputs(
    result,
    buildSecretVariants([...runSecrets, ...params.secretState.subscribedSecrets, ...input.secrets]),
  );
  writeRunFailureContext(stepStream, result);
  return {
    result,
    stream: stepStream,
    logOutcome: stepStream ? undefined : 'abandoned',
    preparedWorkspace: false,
  };
}

function createRunStepLogStream(
  input: Pick<Parameters<typeof executeStep>[0], 'logsDir' | 'step' | 'attempt' | 'jobId'>,
  secrets: string[],
  append: LogAppendFn,
): StepLogStream | undefined {
  try {
    return createStepLogStream({
      logsDir: input.logsDir,
      stepId: input.step.id,
      attempt: input.attempt,
      secrets,
      append,
    });
  } catch (error) {
    logger().error(
      {err: error, jobId: input.jobId, stepId: input.step.id, attempt: input.attempt},
      'Failed to open log capture; running the step without it',
    );
    return undefined;
  }
}

async function runSetupPreparations(
  params: Parameters<typeof executeStep>[0],
): Promise<StepExecution | undefined> {
  const logsFailure = await runSetupPreparation(
    params,
    params.prepareLogs,
    'workspace_prep_failed',
  );
  if (logsFailure) return logsFailure;
  return runSetupPreparation(params, params.prepareAgentState, 'agent_harness_unavailable');
}

async function runSetupPreparation(
  params: Pick<Parameters<typeof executeStep>[0], 'jobId' | 'step' | 'attempt'>,
  prepare: (() => Promise<void>) | undefined,
  reason: 'workspace_prep_failed' | 'agent_harness_unavailable',
): Promise<StepExecution | undefined> {
  if (!prepare) return undefined;
  try {
    await prepare();
    return undefined;
  } catch (error) {
    const result = setupPreparationFailure(error, reason);
    logger().warn(
      {
        err: error,
        jobId: params.jobId,
        stepId: params.step.id,
        attempt: params.attempt,
        reason: result.error?.reason,
      },
      'Setup step failed',
    );
    return {result, logOutcome: 'abandoned', preparedWorkspace: false};
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

function setupPreparationFailure(error: unknown, reason: StepErrorReasonDto): StepResult {
  return {
    success: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      reason,
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
        ...(error.code === undefined ? {} : {code: error.code}),
        ...(error.managedProviderId === undefined
          ? {}
          : {managed_provider_id: error.managedProviderId}),
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
