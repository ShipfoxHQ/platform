import {
  type AgentIntegrationMcpServerConfigDto,
  agentIntegrationMcpServerSchema,
  type ClaudeRuntimeConfigDto,
  type CustomModelProviderRuntimeConfigDto,
  type Harness,
} from '@shipfox/api-agent-dto';
import type {
  AgentConfigIssueDto,
  StepDto,
  StepErrorDto,
  StepErrorReasonDto,
} from '@shipfox/api-workflows-dto';
import type {OutputDeclarations} from '@shipfox/expression';
import {logger} from '@shipfox/node-opentelemetry';
import type {StepResult} from '@shipfox/runner-execution';
import {createIntegrationToolsGatewayFetch, type LeaseTokenSource} from '@shipfox/runner-protocol';
import {z} from 'zod';
import {
  AgentConfigError,
  AgentHarnessUnavailableError,
  AgentInvocationError,
  AgentPermissionModeError,
} from '#core/errors.js';
import type {HarnessAdapter} from '#core/harness.js';
import {
  createIntegrationToolsBridge,
  type IntegrationToolsBridge,
} from '#core/integration-tools-bridge.js';
import {piPackageVersions} from '#core/package-versions.js';
import {piHarnessAdapter} from '#core/pi-adapter.js';

const MAX_HARNESS_DIAGNOSTICS = 5;
const MAX_HARNESS_DIAGNOSTIC_MESSAGE_LENGTH = 500;

export async function executeAgentStep(
  step: StepDto,
  options: {
    signal?: AbortSignal;
    cwd?: string;
    agentStateDir?: string | undefined;
    runtime: {
      harness: Harness;
      provider: string;
      model: string;
      thinking: string;
      credentials: Record<string, string>;
      custom_provider?: CustomModelProviderRuntimeConfigDto | undefined;
      claude?: ClaudeRuntimeConfigDto | undefined;
    };
    gitConfigGlobal?: string | undefined;
    onSessionEntry?: (line: string) => void;
    leaseToken?: LeaseTokenSource | undefined;
    integrationToolsGatewayUrl?: URL | undefined;
  },
): Promise<StepResult> {
  if (step.type !== 'agent') {
    return agentFailure(`Unsupported step type: ${step.type}`);
  }

  const {prompt} = step.config;
  if (typeof prompt !== 'string' || prompt === '') {
    return agentFailure(
      'Agent step config is missing prompt',
      'agent_config_invalid',
      'step_config_invalid',
    );
  }
  const tools = toolsFromConfig(step.config.tools);
  if (tools === 'invalid') {
    return agentFailure(
      'Agent step config has invalid tools.',
      'agent_config_invalid',
      'step_config_invalid',
    );
  }
  const mcpServers = mcpServersFromConfig(step.config.mcpServers);
  if (mcpServers === 'invalid') {
    return agentFailure(
      'Agent step config has invalid integration tools.',
      'agent_config_invalid',
      'step_config_invalid',
    );
  }

  const integrationToolsBridges = integrationToolsBridgesFromConfig(mcpServers, {
    leaseToken: options.leaseToken,
    integrationToolsGatewayUrl: options.integrationToolsGatewayUrl,
  });
  if (integrationToolsBridges === 'invalid') {
    return agentFailure(
      'Agent step config has invalid integration tools.',
      'agent_config_invalid',
      'step_config_invalid',
    );
  }

  try {
    return await runSelectedHarness({
      jobExecutionId: step.job_execution_id,
      stepId: step.id,
      attempt: step.current_attempt,
      cwd: options.cwd ?? process.cwd(),
      agentStateDir: options.agentStateDir,
      harness: options.runtime.harness,
      model: options.runtime.model,
      outputs: outputDeclarationsFromConfig(step.config.outputs),
      prompt,
      tools,
      mcpServers: integrationToolsBridges,
      thinking: options.runtime.thinking,
      provider: options.runtime.provider,
      credentials: options.runtime.credentials,
      customProvider: options.runtime.custom_provider,
      ...(options.runtime.claude === undefined ? {} : {claude: options.runtime.claude}),
      signal: options.signal,
      gitConfigGlobal: options.gitConfigGlobal,
      onSessionEntry: options.onSessionEntry,
    });
  } finally {
    await closeIntegrationToolsBridges(integrationToolsBridges);
  }
}

async function runSelectedHarness(params: {
  jobExecutionId: string;
  stepId: string;
  attempt: number;
  cwd: string;
  agentStateDir: string | undefined;
  harness: Harness;
  model: string;
  outputs: OutputDeclarations | undefined;
  prompt: string;
  tools: readonly string[] | undefined;
  mcpServers: readonly IntegrationToolsBridge[] | undefined;
  thinking: string;
  provider: string;
  credentials: Record<string, string>;
  customProvider: CustomModelProviderRuntimeConfigDto | undefined;
  claude?: ClaudeRuntimeConfigDto | undefined;
  signal: AbortSignal | undefined;
  gitConfigGlobal: string | undefined;
  onSessionEntry: ((line: string) => void) | undefined;
}): Promise<StepResult> {
  const {
    jobExecutionId,
    stepId,
    attempt,
    cwd,
    agentStateDir,
    harness,
    model,
    outputs,
    prompt,
    tools,
    mcpServers,
    thinking,
    provider,
    credentials,
    customProvider,
    claude,
    gitConfigGlobal,
    onSessionEntry,
  } = params;
  const signal = params.signal ?? new AbortController().signal;

  try {
    const adapter = await selectHarnessAdapter(harness);
    const {response, outputs: collectedOutputs} = await raceAbort(
      adapter.run({
        cwd,
        ...(agentStateDir === undefined ? {} : {agentStateDir}),
        model,
        provider,
        thinking,
        prompt,
        ...(tools === undefined ? {} : {tools}),
        ...(mcpServers === undefined ? {} : {mcpServers}),
        outputs,
        credentials,
        customProvider,
        ...(claude === undefined ? {} : {claude}),
        signal,
        ...(gitConfigGlobal ? {gitConfigGlobal} : {}),
        ...(onSessionEntry ? {onSessionEntry} : {}),
      }),
      signal,
    );
    return {
      success: true,
      response: response ?? '',
      ...(collectedOutputs === undefined ? {} : {outputs: collectedOutputs}),
      error: null,
      exit_code: 0,
    };
  } catch (error) {
    if (error instanceof AgentHarnessUnavailableError) {
      logHarnessUnavailable({error, harness, jobExecutionId, stepId, attempt});
    }
    if (error instanceof AgentPermissionModeError) {
      logPermissionModeDowngraded({error, harness, jobExecutionId, stepId, attempt});
    }
    const reason: StepErrorReasonDto =
      error instanceof AgentHarnessUnavailableError
        ? 'agent_harness_unavailable'
        : error instanceof AgentConfigError
          ? 'agent_config_invalid'
          : 'agent_invocation_failed';
    return agentFailure(
      error instanceof Error ? error.message : String(error),
      reason,
      error instanceof AgentConfigError ? error.agentConfigIssue : undefined,
      error instanceof AgentInvocationError ? error.response : undefined,
    );
  }
}

function logPermissionModeDowngraded(params: {
  error: AgentPermissionModeError;
  harness: Harness;
  jobExecutionId: string;
  stepId: string;
  attempt: number;
}): void {
  const {error, harness, jobExecutionId, stepId, attempt} = params;
  logger().error(
    {
      event: 'runner.agent_permission_mode_downgraded',
      harness,
      jobExecutionId,
      stepId,
      attempt,
      requestedPermissionMode: error.requested,
      observedPermissionMode: error.observed,
    },
    'Agent permission mode downgraded',
  );
}

function logHarnessUnavailable(params: {
  error: AgentHarnessUnavailableError;
  harness: Harness;
  jobExecutionId: string;
  stepId: string;
  attempt: number;
}): void {
  const {error, harness, jobExecutionId, stepId, attempt} = params;
  const {environment} = error;
  logger().error(
    {
      event: 'runner.agent_harness_unavailable',
      harness,
      jobExecutionId,
      stepId,
      attempt,
      cwd: environment.cwd,
      provider: environment.provider,
      model: environment.model,
      thinking: environment.thinking,
      requestedExtensionPaths: environment.extensionPaths,
      ...(environment.resolvedExtensionPaths === undefined
        ? {}
        : {resolvedExtensionPaths: environment.resolvedExtensionPaths}),
      diagnostics: error.diagnostics.slice(0, MAX_HARNESS_DIAGNOSTICS).map((diagnostic) => ({
        type: diagnostic.type,
        message: diagnostic.message.slice(0, MAX_HARNESS_DIAGNOSTIC_MESSAGE_LENGTH),
      })),
      resourceLoaderErrors: error.resourceLoaderErrors
        .slice(0, MAX_HARNESS_DIAGNOSTICS)
        .map((resourceError) => ({
          path: resourceError.path,
          error: resourceError.error.slice(0, MAX_HARNESS_DIAGNOSTIC_MESSAGE_LENGTH),
        })),
      packageVersions: piPackageVersions(),
      ...(process.env.RUNNER_VERSION ? {runnerVersion: process.env.RUNNER_VERSION} : {}),
      ...(process.env.IMAGE_REVISION ? {imageRevision: process.env.IMAGE_REVISION} : {}),
      ...(process.env.IMAGE_CREATED ? {imageCreated: process.env.IMAGE_CREATED} : {}),
      ...(process.env.BUILD_NUMBER ? {buildNumber: process.env.BUILD_NUMBER} : {}),
    },
    'Agent harness unavailable',
  );
}

async function selectHarnessAdapter(harness: Harness): Promise<HarnessAdapter> {
  switch (harness) {
    case 'pi':
      return piHarnessAdapter;
    case 'claude':
      return (await import('#core/claude-adapter.js')).claudeHarnessAdapter;
  }
}

// pi has no built-in timeout and may not reject session.prompt() the instant we
// abort. Racing the adapter run call against the abort signal guarantees the step
// loop reaches its abort-before-report guard in seconds instead of hanging until
// lease expiry; the pi adapter still calls session.abort() to stop the agent's own work.
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // `work` (the adapter run call) is already in flight; attach a no-op catch so its
    // eventual rejection can't surface as an unhandled rejection on the aborted path.
    void work.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, {once: true});
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function abortError(): Error {
  const error = new Error('Agent step aborted');
  error.name = 'AbortError';
  return error;
}

// Agent-step failures split into a user-fixable config error (`agent_config_invalid`)
// and a genuine provider/API failure (`agent_invocation_failed`, the default); the
// server derives the `user` category from the step type for both. An aborted step never
// reaches the API: the step loop returns before reporting once the signal fires.
function agentFailure(
  message: string,
  reason: StepErrorReasonDto = 'agent_invocation_failed',
  agentConfigIssue?: AgentConfigIssueDto,
  response?: string,
): StepResult {
  const error: StepErrorDto = {
    message,
    reason,
    ...(agentConfigIssue === undefined ? {} : {agent_config_issue: agentConfigIssue}),
  };
  return {
    success: false,
    ...(response === undefined ? {} : {response}),
    error,
    exit_code: null,
  };
}

function outputDeclarationsFromConfig(value: unknown): OutputDeclarations | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as OutputDeclarations;
}

function toolsFromConfig(value: unknown): readonly string[] | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return 'invalid';
  if (value.some((tool) => typeof tool !== 'string' || tool === '')) return 'invalid';
  return [...value];
}

function mcpServersFromConfig(
  value: unknown,
): readonly AgentIntegrationMcpServerConfigDto[] | undefined | 'invalid' {
  if (value === undefined) return undefined;
  const parsed = z.array(agentIntegrationMcpServerSchema).length(1).safeParse(value);
  return parsed.success ? parsed.data : 'invalid';
}

function integrationToolsBridgesFromConfig(
  mcpServers: readonly AgentIntegrationMcpServerConfigDto[] | undefined,
  options: {
    leaseToken?: LeaseTokenSource | undefined;
    integrationToolsGatewayUrl?: URL | undefined;
  },
): readonly IntegrationToolsBridge[] | undefined | 'invalid' {
  const {leaseToken, integrationToolsGatewayUrl} = options;
  if (mcpServers === undefined) {
    return undefined;
  }
  if (leaseToken === undefined || integrationToolsGatewayUrl === undefined) return 'invalid';

  return mcpServers.map((mcpServer) =>
    createIntegrationToolsBridge({
      name: mcpServer.name,
      url: integrationToolsGatewayUrl,
      fetch: createIntegrationToolsGatewayFetch(leaseToken, integrationToolsGatewayUrl),
    }),
  );
}

async function closeIntegrationToolsBridges(
  bridges: readonly IntegrationToolsBridge[] | undefined,
): Promise<void> {
  const results = await Promise.allSettled(bridges?.map((bridge) => bridge.close()) ?? []);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger().warn({err: result.reason}, 'Failed to close integration tools bridge');
    }
  }
}
