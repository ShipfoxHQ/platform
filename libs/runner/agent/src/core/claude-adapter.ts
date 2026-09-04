import {mkdir, mkdtemp, open, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {TextDecoder} from 'node:util';
import {
  createSdkMcpServer,
  type EffortLevel,
  type Query,
  query,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
  type ThinkingConfig,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import {
  agentIntegrationMcpToolName,
  type ClaudeModelFamilyId,
  claudeRuntimeConfigSchema,
  isReservedModelProviderId,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {config} from '#config.js';
import {CLAUDE_AUTH_HELPER_PATH} from '#core/claude-auth-helper.js';
import {
  CLAUDE_CREDENTIAL_HELPER_TTL_MS,
  type ClaudeCredentialBroker,
  claudeCredentialHelperEnvironment,
  createClaudeCredentialBroker,
} from '#core/claude-credential-broker.js';
import {
  type ClaudeToolCatalogErrorClass,
  type ClaudeToolCatalogFailure,
  type ClaudeToolCatalogFailureReason,
  ClaudeToolDiagnostics,
  type ClaudeToolOmission,
  claudeSdkToolName,
} from '#core/claude-tool-diagnostics.js';
import {assertRunnerEgressAllowed} from '#core/egress.js';
import {
  AgentConfigError,
  AgentInvocationError,
  AgentPermissionModeError,
  AgentSessionUnavailableError,
} from '#core/errors.js';
import type {HarnessAdapter, HarnessInvocation, HarnessResult} from '#core/harness.js';
import {
  OutputCollector,
  RequiredOutputsMissingError,
  runOutputTurnLoop,
  withOutputGuidance,
} from '#core/output-collector.js';
import {toolSelectionOption} from '#core/tool-selection.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com';
const OLLAMA_ANTHROPIC_AUTH_TOKEN = 'ollama';
const REQUESTED_PERMISSION_MODE = 'bypassPermissions';
const OUTPUT_MCP_SERVER_NAME = 'shipfox_outputs';
const MAX_REPOSITORY_INSTRUCTIONS_BYTES = 64 * 1024;
const REPOSITORY_INSTRUCTIONS_HEADER =
  'Repository instructions; they do not override the task above:';
const CLAUDE_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const CLAUDE_SESSION_FILE_NAME = 'claude-session.jsonl';
const CLAUDE_SESSION_LINE_SEPARATOR = /\r?\n/u;
const CLAUDE_MCP_METADATA_TIMEOUT_MS = 10_000;
const CLAUDE_MCP_METADATA_TIMEOUT_MESSAGE = 'Claude integration tool catalog resolution timed out.';

// Shipfox thinking level → extended-thinking budget for legacy Claude models.
// Budgets follow Anthropic's extended-thinking rules (minimum 1,024 tokens;
// max_tokens must exceed the budget) and cap at the ceiling legacy models can
// actually take: their max output defaults to 32,000 tokens and Claude Code
// clamps an enabled-thinking budget to max_tokens - 1, so 31,999 is the
// highest value that reaches the API. Models with a lower output ceiling
// clamp per-model via `ClaudeModelCapabilities.maxThinkingTokens`.
const LEGACY_THINKING_BUDGETS: Readonly<Record<string, number>> = {
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  xhigh: 31_999,
  max: 31_999,
};

/**
 * Per-model Claude capabilities, mirroring the Claude Agent SDK's `ModelInfo`
 * shape (`supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`).
 * The SDK only exposes those fields at runtime through `Query.supportedModels()`,
 * which requires a live session; the adapter needs the same facts before query
 * construction, so the supported Claude catalog (the built-in `anthropic`
 * catalog plus managed catalog entries such as `claude-fable-5`) is mirrored
 * here as typed compatibility metadata. The table keys are type-checked
 * against `CLAUDE_MODEL_FAMILY_IDS` from `@shipfox/api-agent-dto` (the
 * built-in `anthropic` catalog plus managed families), so a capability row
 * without a catalog entry — or a catalog addition without a capability row —
 * fails to compile instead of silently dropping thinking control.
 *
 * Thinking modes follow Anthropic's per-model table: 4.5 and earlier families
 * support only budget-based extended thinking and reject `adaptive`; the 4.6
 * family accepts both (extended deprecated); 4.7 and later accept only
 * `adaptive`. The `effort` parameter is absent on Haiku 4.5 and Sonnet 4.5, is
 * `low | medium | high` on Opus 4.5, and gains `max` from the 4.6 family and
 * `xhigh` from Opus 4.7.
 */
interface ClaudeModelCapabilities {
  readonly supportsAdaptiveThinking: boolean;
  readonly supportsEffort: boolean;
  /** Ascending, so the last entry is the highest level the model accepts. */
  readonly supportedEffortLevels: readonly EffortLevel[];
  /**
   * Highest extended-thinking budget the model accepts. Anthropic requires
   * budget_tokens < max_tokens, so a model whose output caps at 32,000 tokens
   * (Claude Opus 4.1) accepts at most 31,999. Absent means the shared legacy
   * table's ceiling (31,999) applies.
   */
  readonly maxThinkingTokens?: number;
}

const CLAUDE_MODEL_CAPABILITIES: Readonly<Record<string, ClaudeModelCapabilities>> = {
  'claude-haiku-4-5': {
    supportsAdaptiveThinking: false,
    supportsEffort: false,
    supportedEffortLevels: [],
  },
  'claude-opus-4-1': {
    supportsAdaptiveThinking: false,
    supportsEffort: false,
    supportedEffortLevels: [],
    // Output caps at 32,000 tokens; Anthropic requires budget_tokens < max_tokens.
    maxThinkingTokens: 31_999,
  },
  'claude-opus-4-5': {
    supportsAdaptiveThinking: false,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
  'claude-opus-4-6': {
    supportsAdaptiveThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  },
  'claude-opus-4-7': {
    supportsAdaptiveThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'claude-opus-4-8': {
    supportsAdaptiveThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'claude-sonnet-4-5': {
    supportsAdaptiveThinking: false,
    supportsEffort: false,
    supportedEffortLevels: [],
  },
  'claude-sonnet-4-6': {
    supportsAdaptiveThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  },
  'claude-fable-5': {
    supportsAdaptiveThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'claude-opus-5': {
    supportsAdaptiveThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'claude-sonnet-5': {
    supportsAdaptiveThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
} satisfies Readonly<Record<ClaudeModelFamilyId, ClaudeModelCapabilities>>;

interface ClaudeThinkingOptions {
  readonly thinking?: ThinkingConfig;
  readonly effort?: EffortLevel;
}

// Dated snapshot IDs (claude-haiku-4-5-20251001) resolve to their family row.
const MODEL_SNAPSHOT_DATE_SUFFIX = /-\d{8}$/;

function claudeModelCapabilities(model: string): ClaudeModelCapabilities | undefined {
  const familyId = model.replace(MODEL_SNAPSHOT_DATE_SUFFIX, '');
  return CLAUDE_MODEL_CAPABILITIES[familyId];
}

/**
 * Builds the Claude SDK thinking and effort options for the selected model.
 * Shipfox's cross-harness thinking level is not an Anthropic `effort` level:
 * legacy families take a token budget and reject `adaptive`, adaptive families
 * reject a budget, and `effort` exists only on models that advertise it.
 */
function claudeThinkingOptions(model: string, thinking: string): ClaudeThinkingOptions {
  const budget = LEGACY_THINKING_BUDGETS[thinking];
  if (budget === undefined) {
    throw new AgentConfigError(
      `Harness "claude" does not support thinking level "${thinking}". ` +
        `Supported levels: ${CLAUDE_THINKING_LEVELS.join(', ')}.`,
      'step_config_invalid',
    );
  }
  const capabilities = claudeModelCapabilities(model);
  if (capabilities === undefined) {
    // Neither request shape is universally safe for an unknown model (budget
    // thinking is rejected by 4.7 and later, adaptive by 4.5 and earlier), so
    // let the model defaults apply rather than risk an Anthropic 400.
    logger().warn(
      {model, thinking},
      'Unknown Claude model; omitting thinking and effort options so the model defaults apply',
    );
    return {};
  }
  const thinkingOptions: ClaudeThinkingOptions = capabilities.supportsAdaptiveThinking
    ? {thinking: {type: 'adaptive'}}
    : {
        thinking: {
          type: 'enabled',
          budgetTokens: claudeThinkingBudget(model, capabilities, budget),
        },
      };
  return capabilities.supportsEffort
    ? {...thinkingOptions, effort: claudeEffortLevel(capabilities, thinking, model)}
    : thinkingOptions;
}

function claudeThinkingBudget(
  model: string,
  capabilities: ClaudeModelCapabilities,
  requested: number,
): number {
  const ceiling = capabilities.maxThinkingTokens;
  if (ceiling === undefined || requested <= ceiling) return requested;
  // Anthropic rejects budgets at or above the model's max output (budget_tokens
  // must stay below max_tokens), so clamp to the model's ceiling.
  logger().warn(
    {model, requested, applied: ceiling},
    'Claude model caps its thinking budget below the requested level; applying the model maximum',
  );
  return ceiling;
}

// Canonical effort ladder, ascending. Each model's `supportedEffortLevels` is a
// subset of this ladder, so an unsupported request falls back to the nearest
// level at or below it.
const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function claudeEffortLevel(
  capabilities: ClaudeModelCapabilities,
  thinking: string,
  model: string,
): EffortLevel {
  const requested = thinking as EffortLevel;
  if (capabilities.supportedEffortLevels.includes(requested)) return requested;
  // Fall back to the nearest supported level at or below the requested one,
  // matching Claude Code's resolution for levels a model does not offer.
  // Anthropic rejects unsupported levels with HTTP 400, so the request must
  // never carry one; escalating to the highest supported level would silently
  // spend more than the user asked for (xhigh is the harness default).
  const requestedIndex = EFFORT_LEVELS.indexOf(requested);
  const capped = capabilities.supportedEffortLevels
    .filter((level) => EFFORT_LEVELS.indexOf(level) <= requestedIndex)
    .at(-1);
  if (capped !== undefined) {
    logger().warn(
      {model, requested, supported: capabilities.supportedEffortLevels, applied: capped},
      'Claude model does not support the requested effort level; falling back to the nearest supported level at or below it',
    );
    return capped;
  }
  throw new AgentConfigError(
    `Harness "claude" cannot send an effort level for model "${model}".`,
    'step_config_invalid',
  );
}

export const claudeHarnessAdapter: HarnessAdapter = {run: runClaudeAgent};

interface ClaudeAnthropicOverride {
  readonly baseUrl: string;
  readonly model: string | undefined;
  readonly smallFastModel: string | undefined;
  readonly authToken: string;
}

interface ClaudeAuth {
  readonly apiKey: string;
  readonly authToken: string | undefined;
}

async function runClaudeAgent(invocation: HarnessInvocation): Promise<HarnessResult> {
  assertClaudeInvocation(invocation);
  const {
    cwd,
    agentStateDir,
    model,
    thinking,
    prompt,
    credentials,
    gitConfigGlobal,
    signal,
    onSessionEntry,
  } = invocation;
  const collector = new OutputCollector(invocation.outputs);
  const sessionInvocation = invocation.session;
  const shouldPersistSession = sessionInvocation?.mode === 'resume';

  const override = claudeAnthropicOverride(invocation.claude);
  const auth = claudeAuth(credentials, override);
  const targetUrl = override?.baseUrl ?? ANTHROPIC_API_URL;
  const targetLabel = claudeTargetLabel(invocation, override);
  const hasDeclaredOutputs =
    invocation.outputs !== undefined && Object.keys(invocation.outputs).length > 0;
  const useOutputTools = hasDeclaredOutputs;
  let activeToolDiagnostics: ClaudeToolDiagnostics | undefined;
  const managedMcpServers = useOutputTools
    ? [outputMcpServer(collector, () => activeToolDiagnostics)]
    : [];

  await assertRunnerEgressAllowed(targetUrl, targetLabel);

  const effectiveModel = override?.model ?? model;
  const thinkingOptions = claudeThinkingOptions(effectiveModel, thinking);
  const preparationDiagnostics = new ClaudeToolDiagnostics({
    invocation,
    requestedTools: invocation.requestedIntegrationTools ?? [],
    requiredOutputCount: Object.keys(invocation.outputs ?? {}).length,
  });

  let configDir: string | undefined;
  let claudeQuery: Query | undefined;
  let messages: ClaudeInputStream | undefined;
  let sessionStore: ClaudeSessionStore | undefined;
  let sessionId = sessionInvocation?.harnessSessionId;
  let response = '';
  let toolContext: ClaudeToolContext | undefined;
  let turnsCompleted = false;
  let credentialBroker: ClaudeCredentialBroker | undefined;
  const controller = new AbortController();
  const abortQuery = () => {
    controller.abort();
    claudeQuery?.close();
  };

  try {
    assertClaudeNotAborted(signal);
    sessionStore = await createClaudeSessionStore(sessionInvocation);
    toolContext = await createClaudeToolContext(invocation, managedMcpServers);
    activeToolDiagnostics = toolContext.diagnostics;
    toolContext.diagnostics.logManifest();
    configDir = await createClaudeConfigDir(agentStateDir);
    if (invocation.credentialSource !== undefined && invocation.claude !== undefined) {
      credentialBroker = createClaudeCredentialBroker({
        credentialSource: invocation.credentialSource,
        signal,
        socketDirectory: agentStateDir,
      });
      await credentialBroker.start();
    }

    const inputMessages = new ClaudeInputStream();
    messages = inputMessages;
    claudeQuery = query({
      prompt: inputMessages,
      options: {
        model: effectiveModel,
        cwd,
        permissionMode: REQUESTED_PERMISSION_MODE,
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        strictMcpConfig: true,
        ...thinkingOptions,
        abortController: controller,
        ...toolContext.selectedToolOptions,
        ...claudeSystemPromptOption(),
        ...(credentialBroker === undefined
          ? {}
          : {settings: {apiKeyHelper: CLAUDE_AUTH_HELPER_PATH}}),
        env: claudeEnvironment(
          auth,
          configDir,
          gitConfigGlobal,
          override,
          effectiveModel,
          credentialBroker,
        ),
        ...(toolContext.mcpServers === undefined ? {} : {mcpServers: toolContext.mcpServers}),
        ...claudeSessionQueryOptions(sessionInvocation, sessionStore),
        includePartialMessages: false,
      },
    });
    handleClaudeAbort(signal, abortQuery);

    const turnResponse = await runClaudeTurns({
      queryIterator: claudeQuery[Symbol.asyncIterator](),
      messages: inputMessages,
      signal,
      prompt,
      cwd,
      useOutputTools,
      collector,
      toolDiagnostics: toolContext.diagnostics,
      onSessionEntry,
      onSessionId: (id) => {
        sessionId = id;
      },
    });
    response = turnResponse;
    turnsCompleted = true;
    toolContext.diagnostics.finish({
      outputGate: hasDeclaredOutputs ? 'passed' : 'not_required',
    });
    await toolContext.diagnostics.appendToSessionStore(sessionStore, sessionId);
    const persistedSession = await persistClaudeSessionIfNeeded({
      shouldPersistSession,
      agentStateDir,
      session: sessionInvocation,
      sessionStore,
      sessionId,
    });
    return claudeHarnessResult(response, collector.snapshot(), persistedSession);
  } catch (error) {
    const diagnostics = diagnosticsForClaudeFailure(
      toolContext?.diagnostics,
      preparationDiagnostics,
      signal,
    );
    return await handleClaudeAgentFailure({
      error,
      diagnostics,
      collector,
      response,
      sessionId,
      executionCompleted: turnsCompleted,
      shouldPersistSession,
      agentStateDir,
      session: sessionInvocation,
      sessionStore,
      aborted: signal.aborted,
    });
  } finally {
    messages?.close();
    signal.removeEventListener('abort', abortQuery);
    claudeQuery?.close();
    await credentialBroker?.close();
    if (configDir !== undefined) await cleanupClaudeConfigDir(configDir);
  }
}

function diagnosticsForClaudeFailure(
  diagnostics: ClaudeToolDiagnostics | undefined,
  preparationDiagnostics: ClaudeToolDiagnostics,
  signal: AbortSignal,
): ClaudeToolDiagnostics {
  if (diagnostics !== undefined) return diagnostics;
  if (!signal.aborted) preparationDiagnostics.recordPreparationFailure('runner_capability');
  preparationDiagnostics.logManifest();
  return preparationDiagnostics;
}

interface ClaudeToolContext {
  readonly diagnostics: ClaudeToolDiagnostics;
  readonly mcpServers: ReturnType<typeof claudeMcpServers>;
  readonly selectedToolOptions: ReturnType<typeof toolSelectionOption>;
}

async function createClaudeToolContext(
  invocation: HarnessInvocation,
  managedMcpServers: readonly ClaudeManagedMcpServer[],
): Promise<ClaudeToolContext> {
  const integrationTools = await prepareClaudeIntegrationTools(invocation);
  const selectedToolOptions = toolSelectionOption(invocation.tools, [
    ...(invocation.requestedIntegrationTools ?? []).map((tool) =>
      claudeSdkToolName(agentIntegrationMcpToolName(tool.connectionSlug, tool.toolId)),
    ),
    ...integrationTools.resolvedSdkToolNames,
    ...managedMcpServers.flatMap((server) => server.requiredToolNames),
  ]);
  const selectedToolNames = selectedToolOptions.tools;
  const diagnostics = new ClaudeToolDiagnostics({
    invocation,
    requestedTools: invocation.requestedIntegrationTools ?? [],
    resolvedToolNames: integrationTools.resolvedToolNames,
    expectedSdkToolNames: integrationTools.expectedSdkToolNames,
    sdkToolToIntegrationTool: integrationTools.sdkToolToIntegrationTool,
    selectedToolNames,
    omissions: integrationTools.omissions,
    catalogFailures: integrationTools.catalogFailures,
    providerTools: [
      ...integrationTools.providerTools.map(providerFacingClaudeTool),
      ...managedMcpServers.flatMap((server) => server.providerTools),
    ],
    metadataMode: invocation.session?.mode === 'resume' ? 'warm' : 'cold',
    directToolNames: integrationTools.resolvedSdkToolNames,
    proxyFallback: false,
    requiredOutputCount: Object.keys(invocation.outputs ?? {}).length,
  });
  return {
    diagnostics,
    mcpServers: claudeMcpServers(integrationTools.servers, managedMcpServers),
    selectedToolOptions,
  };
}

async function handleClaudeAgentFailure(params: {
  error: unknown;
  diagnostics: ClaudeToolDiagnostics;
  collector: OutputCollector;
  response: string;
  executionCompleted: boolean;
  sessionId: string | undefined;
  shouldPersistSession: boolean;
  agentStateDir: string;
  session: HarnessInvocation['session'];
  sessionStore: ClaudeSessionStore | undefined;
  aborted: boolean;
}): Promise<never> {
  const failurePhase = params.diagnostics.finish({
    outputGate: outputGateForError(params.error),
    missingOutputCount: params.collector.missingRequired().length,
    executionFailed: true,
    executionCompleted: params.executionCompleted,
    aborted: params.aborted,
  });
  await params.diagnostics.appendToSessionStore(params.sessionStore, params.sessionId);
  return await rethrowClaudeSessionError({
    error: classifyClaudeAgentError({
      error: params.error,
      failurePhase,
      response: params.response,
      sessionId: params.sessionId,
    }),
    shouldPersistSession: params.shouldPersistSession,
    agentStateDir: params.agentStateDir,
    session: params.session,
    sessionStore: params.sessionStore,
    sessionId: params.sessionId,
    response: params.response,
  });
}

function outputGateForError(error: unknown): 'failed' | 'not_evaluated' {
  return error instanceof AgentInvocationError && error.failurePhase === 'output_gate_failed'
    ? 'failed'
    : 'not_evaluated';
}

function classifyClaudeAgentError(params: {
  error: unknown;
  failurePhase: ReturnType<ClaudeToolDiagnostics['finish']>;
  response: string;
  sessionId: string | undefined;
}): unknown {
  if (
    params.failurePhase === undefined ||
    params.error instanceof AgentInvocationError ||
    params.error instanceof AgentConfigError ||
    params.error instanceof AgentSessionUnavailableError ||
    params.error instanceof AgentPermissionModeError
  ) {
    return params.error;
  }
  return new AgentInvocationError(
    params.error instanceof Error ? params.error.message : String(params.error),
    params.response,
    undefined,
    params.sessionId,
    params.failurePhase,
  );
}

function assertClaudeNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Agent step aborted before the Claude session started');
}

function handleClaudeAbort(signal: AbortSignal, abortQuery: () => void): void {
  signal.addEventListener('abort', abortQuery, {once: true});
  if (signal.aborted) {
    abortQuery();
    throw new Error('Agent step aborted before the Claude session started');
  }
}

function claudeHarnessResult(
  response: string,
  outputs: Record<string, string>,
  persistedSession: {sessionFile: string; sessionId: string} | undefined,
): HarnessResult {
  return {
    response,
    ...(Object.keys(outputs).length === 0 ? {} : {outputs}),
    ...(persistedSession === undefined ? {} : persistedSession),
  };
}

function persistClaudeSessionIfNeeded(params: {
  shouldPersistSession: boolean;
  agentStateDir: string;
  session: HarnessInvocation['session'];
  sessionStore: ClaudeSessionStore | undefined;
  sessionId: string | undefined;
}): Promise<{sessionFile: string; sessionId: string} | undefined> {
  if (!params.shouldPersistSession) return Promise.resolve(undefined);
  return persistClaudeSession(params);
}

async function rethrowClaudeSessionError(params: {
  error: unknown;
  shouldPersistSession: boolean;
  agentStateDir: string;
  session: HarnessInvocation['session'];
  sessionStore: ClaudeSessionStore | undefined;
  sessionId: string | undefined;
  response: string;
}): Promise<never> {
  const {error} = params;
  if (
    !params.shouldPersistSession ||
    params.sessionStore === undefined ||
    params.sessionId === undefined ||
    error instanceof AgentSessionUnavailableError ||
    error instanceof AgentPermissionModeError
  ) {
    throw error;
  }
  const persistedSession = await persistClaudeSession({
    agentStateDir: params.agentStateDir,
    session: params.session,
    sessionStore: params.sessionStore,
    sessionId: params.sessionId,
  });
  if (error instanceof AgentInvocationError) {
    throw new AgentInvocationError(
      error.message,
      error.response ?? params.response,
      persistedSession.sessionFile,
      params.sessionId,
      error.failurePhase,
    );
  }
  throw new AgentInvocationError(
    error instanceof Error ? error.message : String(error),
    params.response,
    persistedSession.sessionFile,
    params.sessionId,
  );
}

function assertClaudeInvocation(
  invocation: HarnessInvocation,
): asserts invocation is HarnessInvocation & {agentStateDir: string} {
  if (invocation.signal.aborted) {
    throw new Error('Agent step aborted before the Claude session started');
  }
  if (invocation.agentStateDir === undefined) throw new Error('Agent state directory is required');
  const claudeBlock = invocation.claude;
  if (claudeBlock !== undefined && !claudeRuntimeConfigSchema.safeParse(claudeBlock).success) {
    throw new AgentConfigError(
      'Harness "claude" received a malformed per-step claude runtime block.',
      'step_config_invalid',
    );
  }
  if (invocation.provider !== 'anthropic' && claudeBlock === undefined) {
    const reason = isReservedModelProviderId(invocation.provider)
      ? `Harness "claude" only supports provider "anthropic"; received "${invocation.provider}".`
      : `Harness "claude" requires the server-issued per-step claude runtime block for provider "${invocation.provider}"; the block was not present in this invocation.`;
    throw new AgentConfigError(reason, 'provider_unsupported');
  }
  if (invocation.customProvider !== undefined) {
    throw new AgentConfigError(
      'Harness "claude" does not support custom model providers.',
      'provider_unsupported',
    );
  }
}

function claudeTargetLabel(
  invocation: HarnessInvocation,
  override: ClaudeAnthropicOverride | undefined,
): string {
  if (invocation.claude !== undefined) return 'Claude Anthropic per-step endpoint';
  if (override === undefined) return 'Claude Anthropic API endpoint';
  return 'Claude Anthropic base URL override';
}

function claudeMcpServers(
  integrationMcpServers: readonly ClaudeIntegrationMcpServer[],
  managedMcpServers: readonly ClaudeManagedMcpServer[],
) {
  const servers: Record<string, ClaudeMcpServerConfig> = Object.fromEntries(
    integrationMcpServers.map((server) => [server.name, server.config]),
  );
  for (const server of managedMcpServers) {
    servers[server.name] = server.config;
  }
  return Object.keys(servers).length === 0 ? undefined : servers;
}

type ClaudeMcpServerConfig =
  | ClaudeIntegrationMcpServer['config']
  | ReturnType<typeof createSdkMcpServer>;

interface ClaudeManagedMcpServer {
  readonly name: string;
  readonly config: ReturnType<typeof createSdkMcpServer>;
  readonly requiredToolNames: readonly string[];
  readonly providerTools: readonly ClaudeProviderTool[];
}

interface ClaudeIntegrationMcpServer {
  readonly name: string;
  readonly config: {
    readonly type: 'http';
    readonly url: string;
    readonly alwaysLoad: true;
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly providerTools: readonly ClaudeProviderTool[];
  readonly resolvedToolNames: readonly string[];
  readonly listToolsFailed: boolean;
  readonly catalogFailure?: ClaudeToolCatalogFailure;
}

interface PreparedClaudeIntegrationTools {
  readonly servers: readonly ClaudeIntegrationMcpServer[];
  readonly providerTools: readonly ClaudeProviderTool[];
  readonly resolvedToolNames: readonly string[];
  readonly resolvedSdkToolNames: readonly string[];
  readonly expectedSdkToolNames: readonly string[];
  readonly sdkToolToIntegrationTool: ReadonlyMap<string, string>;
  readonly omissions: readonly ClaudeToolOmission[];
  readonly catalogFailures: readonly ClaudeToolCatalogFailure[];
}

interface ClaudeProviderTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: unknown;
  readonly outputSchema?: unknown | undefined;
}

function providerFacingClaudeTool(tool: ClaudeProviderTool): ClaudeProviderTool {
  return {...tool, name: claudeSdkToolName(tool.name)};
}

async function prepareClaudeIntegrationTools(
  invocation: HarnessInvocation,
): Promise<PreparedClaudeIntegrationTools> {
  const bridges = invocation.mcpServers ?? [];
  const requestedToolNames = uniqueStrings(
    (invocation.requestedIntegrationTools ?? []).map((tool) =>
      agentIntegrationMcpToolName(tool.connectionSlug, tool.toolId),
    ),
  );
  const preparedServers = await Promise.all(
    bridges.map(async (bridge): Promise<ClaudeIntegrationMcpServer> => {
      const authToken = crypto.randomUUID();
      const [endpoint, listed] = await Promise.all([
        boundedPromise(
          Promise.resolve().then(() =>
            bridge.activateHttp({
              authToken,
              signal: invocation.signal,
              timeout: CLAUDE_MCP_METADATA_TIMEOUT_MS,
            }),
          ),
          {
            signal: invocation.signal,
            timeoutMs: CLAUDE_MCP_METADATA_TIMEOUT_MS,
            timeoutMessage: 'Claude integration tools bridge activation timed out.',
          },
        ),
        listClaudeIntegrationToolNames(bridge, invocation.signal),
      ]);
      const catalogFailure =
        listed.failureReason === undefined
          ? undefined
          : ({
              server: bridge.name,
              reason: listed.failureReason,
              errorClass: listed.errorClass ?? 'unknown',
              ...(listed.errorStatus === undefined ? {} : {errorStatus: listed.errorStatus}),
            } satisfies ClaudeToolCatalogFailure);
      return {
        name: bridge.name,
        config: {
          type: 'http',
          url: endpoint.toString(),
          alwaysLoad: true,
          headers: {Authorization: `Bearer ${authToken}`},
        },
        providerTools: listed.tools,
        resolvedToolNames: listed.toolNames,
        listToolsFailed: listed.failed,
        ...(catalogFailure === undefined ? {} : {catalogFailure}),
      };
    }),
  );
  const resolvedToolNames = uniqueStrings(
    preparedServers.flatMap((server) => server.resolvedToolNames),
  );
  const resolvedSdkToolNames = resolvedToolNames.map(claudeSdkToolName);
  const expectedIntegrationToolNames = uniqueStrings([...requestedToolNames, ...resolvedToolNames]);
  const expectedSdkToolNames = expectedIntegrationToolNames.map(claudeSdkToolName);
  const sdkToolToIntegrationTool = new Map<string, string>();
  expectedSdkToolNames.forEach((sdkName, index) => {
    const integrationName = expectedIntegrationToolNames[index];
    if (integrationName !== undefined) sdkToolToIntegrationTool.set(sdkName, integrationName);
  });
  const omissions = requestedToolNames.flatMap((toolName) => {
    if (preparedServers.some((server) => server.resolvedToolNames.includes(toolName))) return [];
    const reason = omissionReason(preparedServers);
    return reason === undefined ? [] : [{toolName, reason} satisfies ClaudeToolOmission];
  });
  const catalogFailures = preparedServers.flatMap((server) =>
    server.catalogFailure === undefined ? [] : [server.catalogFailure],
  );
  return {
    servers: preparedServers,
    providerTools: preparedServers.flatMap((server) => server.providerTools),
    resolvedToolNames,
    resolvedSdkToolNames,
    expectedSdkToolNames,
    sdkToolToIntegrationTool,
    omissions,
    catalogFailures,
  };
}

function omissionReason(
  servers: readonly ClaudeIntegrationMcpServer[],
): ClaudeToolOmission['reason'] | undefined {
  if (servers.length === 0) return 'runner_capability';
  if (servers.every((server) => server.listToolsFailed)) {
    return servers.every((server) => server.catalogFailure?.reason === 'connection_policy')
      ? 'connection_policy'
      : undefined;
  }
  return 'catalog_resolution';
}

interface ClaudeToolCatalogResult {
  readonly tools: readonly ClaudeProviderTool[];
  readonly toolNames: readonly string[];
  readonly failed: boolean;
  readonly failureReason?: ClaudeToolCatalogFailureReason;
  readonly errorClass?: ClaudeToolCatalogErrorClass;
  readonly errorStatus?: number;
}

async function listClaudeIntegrationToolNames(
  bridge: NonNullable<HarnessInvocation['mcpServers']>[number],
  signal: AbortSignal,
): Promise<ClaudeToolCatalogResult> {
  const controller = new AbortController();

  try {
    const result = await boundedPromise(
      Promise.resolve().then(() =>
        bridge.listTools({
          signal: controller.signal,
          timeout: CLAUDE_MCP_METADATA_TIMEOUT_MS,
        }),
      ),
      {
        signal,
        timeoutMs: CLAUDE_MCP_METADATA_TIMEOUT_MS,
        timeoutMessage: CLAUDE_MCP_METADATA_TIMEOUT_MESSAGE,
        onAbort: () => controller.abort(signal.reason),
        onTimeout: () => controller.abort(new Error(CLAUDE_MCP_METADATA_TIMEOUT_MESSAGE)),
      },
    );
    return {
      tools: result.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : {description: tool.description}),
        inputSchema: tool.inputSchema,
        ...('outputSchema' in tool && tool.outputSchema !== undefined
          ? {outputSchema: tool.outputSchema}
          : {}),
      })),
      toolNames: result.tools.map((tool) => tool.name),
      failed: false,
    };
  } catch (error) {
    if (signal.aborted) throw error;
    const failureReason = catalogFailureReason(error);
    const errorStatus = catalogErrorStatus(error);
    const errorClass = catalogErrorClass(error, errorStatus);
    logger().warn(
      {
        event: 'runner.agent_claude_tool_catalog_unavailable',
        server: bridge.name,
        failureReason,
        errorClass,
        ...(errorStatus === undefined ? {} : {errorStatus}),
      },
      'Claude integration tool catalog could not be resolved before invocation',
    );
    return {
      tools: [],
      toolNames: [],
      failed: true,
      failureReason,
      errorClass,
      ...(errorStatus === undefined ? {} : {errorStatus}),
    };
  }
}

function catalogFailureReason(error: unknown): ClaudeToolCatalogFailureReason {
  const status = catalogErrorStatus(error);
  return status === 401 || status === 403 ? 'connection_policy' : 'catalog_resolution';
}

function catalogErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.status ?? error.statusCode ?? error.code;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function catalogErrorClass(
  error: unknown,
  status: number | undefined,
): ClaudeToolCatalogErrorClass {
  if (status !== undefined) return 'http';
  if (error instanceof Error && error.message === CLAUDE_MCP_METADATA_TIMEOUT_MESSAGE) {
    return 'timeout';
  }
  if (error instanceof TypeError) return 'transport';
  return 'unknown';
}

function boundedPromise<T>(
  work: Promise<T>,
  params: {
    signal: AbortSignal;
    timeoutMs: number;
    timeoutMessage: string;
    onAbort?: () => void;
    onTimeout?: () => void;
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      params.onTimeout?.();
      settle(() => reject(new Error(params.timeoutMessage)));
    }, params.timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      params.signal.removeEventListener('abort', onAbort);
    };
    const settle = (handler: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler();
    };
    const onAbort = () => {
      params.onAbort?.();
      settle(() =>
        reject(params.signal.reason ?? new Error('Claude integration preparation aborted.')),
      );
    };

    work.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
    if (params.signal.aborted) onAbort();
    else params.signal.addEventListener('abort', onAbort, {once: true});
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

type ClaudeMcpTools = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>;

function outputMcpServer(
  collector: OutputCollector,
  diagnostics: () => ClaudeToolDiagnostics | undefined,
): ClaudeManagedMcpServer {
  const toolDescription = 'Set one structured output value for this workflow step.';
  return managedMcpServer({
    name: OUTPUT_MCP_SERVER_NAME,
    version: '1.0.0',
    instructions: collector.guidanceText(),
    tools: [setOutputTool(collector, diagnostics)],
    providerTools: [
      {
        name: `mcp__${OUTPUT_MCP_SERVER_NAME}__set_output`,
        description: toolDescription,
        inputSchema: {
          type: 'object',
          properties: {
            key: {type: 'string'},
            value: {type: 'string'},
          },
          required: ['key', 'value'],
          additionalProperties: false,
        },
      },
    ],
  });
}

function managedMcpServer<Tools extends ClaudeMcpTools>(params: {
  name: string;
  version: string;
  instructions: string;
  tools: Tools;
  providerTools?: readonly ClaudeProviderTool[] | undefined;
}): ClaudeManagedMcpServer {
  return {
    name: params.name,
    config: createSdkMcpServer({...params, alwaysLoad: true}),
    requiredToolNames: params.tools.map(
      (managedTool) => `mcp__${params.name}__${managedTool.name}`,
    ),
    providerTools: params.providerTools ?? [],
  };
}

function setOutputTool(
  collector: OutputCollector,
  diagnostics: () => ClaudeToolDiagnostics | undefined,
) {
  return tool(
    'set_output',
    'Set one structured output value for this workflow step.',
    {key: z.string(), value: z.string()},
    async (args) => {
      await Promise.resolve();
      const result = collector.trySet(args.key, args.value);
      diagnostics()?.recordOutputWrite({
        key: args.key,
        value: args.value,
        result: {
          ok: result.ok,
          ...(result.ok && 'idempotent' in result && result.idempotent === true
            ? {idempotent: true}
            : {}),
          ...(!result.ok
            ? {
                code: result.code,
                ...(result.details.schemaError === undefined
                  ? {}
                  : {reason: result.details.schemaError}),
              }
            : {}),
        },
      });
      return {
        content: [
          {
            type: 'text',
            text: result.ok ? `Output "${args.key}" set.` : result.feedback,
          },
        ],
        ...(result.ok ? {} : {isError: true, structuredContent: result}),
      };
    },
    {alwaysLoad: true},
  );
}

function claudeSessionQueryOptions(
  session: HarnessInvocation['session'],
  sessionStore: ClaudeSessionStore | undefined,
) {
  const resumedSessionId = session?.file === undefined ? undefined : sessionResumeId(session);
  return {
    persistSession: sessionStore !== undefined,
    ...(sessionStore === undefined ? {} : {sessionStore, sessionStoreFlush: 'batched' as const}),
    ...(resumedSessionId === undefined
      ? {}
      : {
          resume: resumedSessionId,
          ...(session?.mode === 'fork' ? {forkSession: true} : {}),
        }),
  };
}

async function runClaudeTurns(params: {
  queryIterator: AsyncIterator<unknown>;
  messages: ClaudeInputStream;
  signal: AbortSignal;
  prompt: string;
  cwd: string;
  useOutputTools: boolean;
  collector: OutputCollector;
  toolDiagnostics: ClaudeToolDiagnostics;
  onSessionEntry: ((line: string) => void) | undefined;
  onSessionId: (sessionId: string) => void;
}): Promise<string> {
  let response = '';
  try {
    await runOutputTurnLoop({
      signal: params.signal,
      prompt: withClaudePromptGuidance(
        params.prompt,
        await repositoryInstructions(params.cwd),
        params.useOutputTools ? params.collector.guidanceText() : undefined,
      ),
      missingRequired: () => params.collector.missingRequired(),
      guidanceForMissing: (missing) => params.collector.guidanceTextFor(missing),
      runTurn: async (message) => {
        params.toolDiagnostics.recordTurnStart();
        params.messages.push(userMessage(message));
        response =
          (
            await readClaudeResult({
              queryIterator: params.queryIterator,
              toolDiagnostics: params.toolDiagnostics,
              onSessionEntry: params.onSessionEntry,
              onSessionId: params.onSessionId,
            })
          ).response ?? '';
      },
    });
  } catch (error) {
    if (error instanceof RequiredOutputsMissingError) {
      throw new AgentInvocationError(
        error.message,
        response,
        undefined,
        undefined,
        'output_gate_failed',
      );
    }
    throw error;
  }
  return response;
}

async function readClaudeResult(params: {
  queryIterator: AsyncIterator<unknown>;
  toolDiagnostics: ClaudeToolDiagnostics;
  onSessionEntry: ((line: string) => void) | undefined;
  onSessionId: (sessionId: string) => void;
}): Promise<HarnessResult> {
  while (true) {
    const next = await params.queryIterator.next();
    if (next.done === true) break;
    const message = next.value;
    params.toolDiagnostics.recordMessage(message);
    forwardSessionEntry(params.onSessionEntry, message);
    if (isInitMessage(message)) {
      params.onSessionId(message.session_id);
      assertPermissionMode(message);
    }
    if (!isResultMessage(message)) continue;
    return claudeResult(message);
  }

  throw new Error('Claude agent did not emit a result message.');
}

class ClaudeSessionStore implements SessionStore {
  readonly #entries = new Map<string, SessionStoreEntry[]>();
  readonly #serializedPrefixes = new Map<string, string>();
  readonly #appendedEntries = new Map<string, SessionStoreEntry[]>();

  constructor(
    sessionId: string | undefined,
    entries: readonly SessionStoreEntry[],
    serializedPrefix = '',
  ) {
    if (sessionId === undefined) return;
    const key = sessionStoreKey({sessionId});
    this.#entries.set(key, [...entries]);
    this.#serializedPrefixes.set(key, serializedPrefix);
  }

  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const keyString = sessionStoreKey(key);
    const stored = this.#entries.get(keyString) ?? [];
    const uuids = new Set(
      stored.flatMap((entry) => (entry.uuid === undefined ? [] : [entry.uuid])),
    );
    const appended = this.#appendedEntries.get(keyString) ?? [];
    for (const entry of entries) {
      if (entry.uuid !== undefined && uuids.has(entry.uuid)) continue;
      stored.push(entry);
      appended.push(entry);
      if (entry.uuid !== undefined) uuids.add(entry.uuid);
    }
    this.#entries.set(keyString, stored);
    this.#appendedEntries.set(keyString, appended);
    return Promise.resolve();
  }

  load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const entries = this.#entries.get(sessionStoreKey(key));
    return Promise.resolve(entries === undefined ? null : [...entries]);
  }

  serializedFor(sessionId: string): string {
    const key = sessionStoreKey({sessionId});
    const prefix = this.#serializedPrefixes.get(key) ?? '';
    const appended = this.#appendedEntries.get(key) ?? [];
    if (appended.length === 0) return prefix;
    const separator = prefix === '' || prefix.endsWith('\n') ? '' : '\n';
    return `${prefix}${separator}${appended.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
  }
}

function sessionStoreKey(key: Pick<SessionKey, 'sessionId' | 'subpath'>): string {
  return `${key.sessionId}\u0000${key.subpath ?? ''}`;
}

async function createClaudeSessionStore(
  session: HarnessInvocation['session'],
): Promise<ClaudeSessionStore | undefined> {
  if (session === undefined || (session.mode === 'fork' && session.file === undefined)) {
    return undefined;
  }
  const sessionFile = session.file;
  if (sessionFile === undefined) return new ClaudeSessionStore(undefined, []);

  const sessionId = sessionResumeId(session);
  try {
    const contents = await readFile(sessionFile, 'utf8');
    const entries = contents
      .split(CLAUDE_SESSION_LINE_SEPARATOR)
      .filter((line) => line.trim() !== '')
      .map((line) => parseClaudeSessionEntry(line, sessionFile));
    return new ClaudeSessionStore(sessionId, entries, contents);
  } catch (error) {
    if (error instanceof AgentSessionUnavailableError) throw error;
    throw new AgentSessionUnavailableError(
      `Claude could not load the agent session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseClaudeSessionEntry(line: string, file: string): SessionStoreEntry {
  try {
    const entry: unknown = JSON.parse(line);
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('type' in entry) ||
      typeof entry.type !== 'string'
    ) {
      throw new Error('session entry is missing its type');
    }
    return entry as SessionStoreEntry;
  } catch (error) {
    throw new AgentSessionUnavailableError(
      `Claude could not load the agent session: invalid transcript entry in ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sessionResumeId(session: NonNullable<HarnessInvocation['session']>): string {
  if (session.harnessSessionId === undefined || session.harnessSessionId === '') {
    throw new AgentSessionUnavailableError(
      'Claude could not load the agent session: the transcript has no native session id',
    );
  }
  return session.harnessSessionId;
}

async function persistClaudeSession(params: {
  agentStateDir: string;
  session: HarnessInvocation['session'];
  sessionStore: ClaudeSessionStore | undefined;
  sessionId: string | undefined;
}): Promise<{sessionFile: string; sessionId: string}> {
  if (params.sessionStore === undefined || params.sessionId === undefined) {
    throw new AgentSessionUnavailableError(
      'Claude did not emit a native session id or session store transcript',
    );
  }
  let entries: SessionStoreEntry[] | null;
  try {
    entries = await params.sessionStore.load({projectKey: '', sessionId: params.sessionId});
  } catch (error) {
    throw new AgentSessionUnavailableError(
      `Claude could not read the agent session store: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (entries === null || entries.length === 0) {
    throw new AgentSessionUnavailableError('Claude did not produce a session transcript');
  }
  const sessionFile =
    params.session?.file ?? join(params.agentStateDir, 'sessions', CLAUDE_SESSION_FILE_NAME);
  try {
    await mkdir(join(params.agentStateDir, 'sessions'), {recursive: true});
    await writeFile(sessionFile, params.sessionStore.serializedFor(params.sessionId));
  } catch (error) {
    throw new AgentSessionUnavailableError(
      `Claude could not persist the agent session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {sessionFile, sessionId: params.sessionId};
}

function isInitMessage(message: unknown): message is SDKSystemMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'system' &&
    'subtype' in message &&
    message.subtype === 'init'
  );
}

function assertPermissionMode(message: SDKSystemMessage): void {
  const observed = message.permissionMode;
  if (observed === undefined || observed === REQUESTED_PERMISSION_MODE) return;
  throw new AgentPermissionModeError(REQUESTED_PERMISSION_MODE, observed);
}

function isResultMessage(message: unknown): message is SDKResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'result'
  );
}

class ClaudeInputStream implements AsyncIterable<SDKUserMessage> {
  readonly #messages: SDKUserMessage[] = [];
  readonly #waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(message: SDKUserMessage): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter({done: false, value: message});
      return;
    }
    this.#messages.push(message);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({done: true, value: undefined});
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.#messages.shift();
        if (message !== undefined) return Promise.resolve({done: false, value: message});
        if (this.#closed) return Promise.resolve({done: true, value: undefined});
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) =>
          this.#waiters.push(resolve),
        );
      },
    };
  }
}

function userMessage(content: string): SDKUserMessage {
  return {
    type: 'user',
    message: {role: 'user', content},
    parent_tool_use_id: null,
  };
}

function claudeSystemPromptOption(): {readonly systemPrompt?: string} {
  const systemPrompt = claudeSystemPrompt();
  return systemPrompt === undefined ? {} : {systemPrompt};
}

function claudeSystemPrompt(): string | undefined {
  // Keep trusted Shipfox instructions separate from repository prompt content; this seam stays empty until that contract exists.
  return undefined;
}

function withClaudePromptGuidance(
  prompt: string,
  instructions: string | undefined,
  outputGuidance: string | undefined,
): string {
  const promptWithInstructions =
    instructions === undefined
      ? prompt
      : `${prompt}\n\n${REPOSITORY_INSTRUCTIONS_HEADER}\n\n${instructions}`;
  return outputGuidance === undefined
    ? promptWithInstructions
    : withOutputGuidance(promptWithInstructions, outputGuidance);
}

async function repositoryInstructions(cwd: string): Promise<string | undefined> {
  const candidates = [join(cwd, 'CLAUDE.md'), join(cwd, 'AGENTS.md')];
  const failures: string[] = [];

  for (const candidate of candidates) {
    try {
      const bytes = await readRepositoryInstructionBytes(candidate);
      const contents = bytes.toString('utf8');
      if (contents.trim().length === 0) continue;
      if (bytes.byteLength <= MAX_REPOSITORY_INSTRUCTIONS_BYTES) {
        return contents;
      }

      logger().warn(
        {
          path: candidate,
          maxBytes: MAX_REPOSITORY_INSTRUCTIONS_BYTES,
        },
        'Repository instructions were truncated before Claude agent invocation',
      );
      return truncateUtf8(bytes, MAX_REPOSITORY_INSTRUCTIONS_BYTES);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (failures.length === 0) return undefined;

  logger().warn(
    {cwd, candidates, failures},
    'No readable repository instructions found for Claude agent invocation',
  );
  return undefined;
}

async function readRepositoryInstructionBytes(path: string): Promise<Buffer> {
  const file = await open(path, 'r');
  const bytes = Buffer.alloc(MAX_REPOSITORY_INSTRUCTIONS_BYTES + 1);
  let bytesRead = 0;

  try {
    while (bytesRead < bytes.length) {
      const result = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

function truncateUtf8(bytes: Buffer, maxBytes: number): string {
  return new TextDecoder('utf-8').decode(bytes.subarray(0, maxBytes), {stream: true});
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function createClaudeConfigDir(agentStateDir: string): Promise<string> {
  await mkdir(agentStateDir, {recursive: true});
  return mkdtemp(join(agentStateDir, 'claude-config-'));
}

async function cleanupClaudeConfigDir(configDir: string): Promise<void> {
  try {
    await rm(configDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (error) {
    logger().warn({err: error, configDir}, 'Failed to remove Claude configuration');
  }
}

function forwardSessionEntry(
  onSessionEntry: ((line: string) => void) | undefined,
  message: unknown,
): void {
  try {
    onSessionEntry?.(JSON.stringify(message));
  } catch {
    // Session capture is best-effort; a log sink failure must not fail the agent turn.
  }
}

function claudeEnvironment(
  auth: ClaudeAuth,
  configDir: string,
  gitConfigGlobal: string | undefined,
  override: ClaudeAnthropicOverride | undefined,
  effectiveModel: string,
  credentialBroker: ClaudeCredentialBroker | undefined,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {...process.env};
  if (credentialBroker === undefined) {
    environment.ANTHROPIC_API_KEY = auth.apiKey;
    if (auth.authToken !== undefined) environment.ANTHROPIC_AUTH_TOKEN = auth.authToken;
  } else {
    delete environment.ANTHROPIC_API_KEY;
    delete environment.ANTHROPIC_AUTH_TOKEN;
    Object.assign(environment, claudeCredentialHelperEnvironment(credentialBroker), {
      CLAUDE_CODE_API_KEY_HELPER_TTL_MS: String(CLAUDE_CREDENTIAL_HELPER_TTL_MS),
      ANTHROPIC_SMALL_FAST_MODEL: effectiveModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: effectiveModel,
      CLAUDE_CODE_SUBAGENT_MODEL: effectiveModel,
    });
  }

  Object.assign(environment, {
    ...(override !== undefined
      ? {
          ANTHROPIC_BASE_URL: override.baseUrl,
          ...(override.model !== undefined ? {ANTHROPIC_MODEL: override.model} : {}),
          ...(override.smallFastModel !== undefined
            ? {ANTHROPIC_SMALL_FAST_MODEL: override.smallFastModel}
            : {}),
        }
      : {}),
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_AGENT_SDK_CLIENT_APP: '@shipfox/runner-agent',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    ...(gitConfigGlobal ? {GIT_CONFIG_GLOBAL: gitConfigGlobal} : {}),
  });
  return environment;
}

function claudeAnthropicOverride(
  runtimeConfig: HarnessInvocation['claude'],
): ClaudeAnthropicOverride | undefined {
  if (runtimeConfig !== undefined) {
    return {
      baseUrl: runtimeConfig.base_url,
      model: undefined,
      smallFastModel: undefined,
      authToken: runtimeConfig.auth_token,
    };
  }

  if (config.AGENT_CLAUDE_ANTHROPIC_BASE_URL === undefined) return undefined;

  return {
    baseUrl: config.AGENT_CLAUDE_ANTHROPIC_BASE_URL,
    model: config.AGENT_CLAUDE_ANTHROPIC_MODEL,
    smallFastModel: config.AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL,
    authToken: OLLAMA_ANTHROPIC_AUTH_TOKEN,
  };
}

function claudeAuth(
  credentials: Record<string, string>,
  override: ClaudeAnthropicOverride | undefined,
): ClaudeAuth {
  if (override !== undefined) {
    return {apiKey: '', authToken: override.authToken};
  }

  const apiKey = credentials.api_key;
  if (apiKey === undefined || apiKey === '') {
    throw new AgentConfigError(
      'No credentials configured for provider "anthropic". ' +
        'Verify the provider is configured for this workspace.',
      'provider_not_configured',
    );
  }

  return {apiKey, authToken: undefined};
}

function claudeResult(message: SDKResultMessage): HarnessResult {
  if (message.is_error || message.subtype !== 'success') {
    throw new Error(claudeErrorMessage(message));
  }
  return {response: message.result};
}

function claudeErrorMessage(message: SDKResultMessage): string {
  if ('result' in message && message.result !== '') return message.result;
  if ('errors' in message && message.errors.length > 0) return message.errors.join('\n');
  return `Claude agent returned ${message.subtype}.`;
}
