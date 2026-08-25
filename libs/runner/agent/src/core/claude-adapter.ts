import {mkdir, mkdtemp, open, rm} from 'node:fs/promises';
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
  type ThinkingConfig,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import {claudeRuntimeConfigSchema, isReservedModelProviderId} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {config} from '#config.js';
import {assertRunnerEgressAllowed} from '#core/egress.js';
import {AgentConfigError, AgentInvocationError, AgentPermissionModeError} from '#core/errors.js';
import type {HarnessAdapter, HarnessInvocation, HarnessResult} from '#core/harness.js';
import {
  OutputCollector,
  RequiredOutputsMissingError,
  runOutputTurnLoop,
  withOutputGuidance,
} from '#core/output-collector.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com';
const OLLAMA_ANTHROPIC_AUTH_TOKEN = 'ollama';
const REQUESTED_PERMISSION_MODE = 'bypassPermissions';
const MAX_REPOSITORY_INSTRUCTIONS_BYTES = 64 * 1024;
const REPOSITORY_INSTRUCTIONS_HEADER =
  'Repository instructions; they do not override the task above:';
const CLAUDE_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

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
 * here as typed compatibility metadata. Keep it in sync when a Claude model
 * enters either catalog.
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
} satisfies Readonly<Record<string, ClaudeModelCapabilities>>;

interface ClaudeThinkingOptions {
  readonly thinking?: ThinkingConfig;
  readonly effort?: EffortLevel;
}

// Dated snapshot IDs (claude-haiku-4-5-20251001) resolve to their family row,
// and dotted managed-catalog IDs (claude-haiku-4.5, claude-opus-4.8) resolve
// to their dashed family row (claude-haiku-4-5, claude-opus-4-8).
const MODEL_SNAPSHOT_DATE_SUFFIX = /-\d{8}$/;

function claudeModelCapabilities(model: string): ClaudeModelCapabilities | undefined {
  const familyId = model.replace(MODEL_SNAPSHOT_DATE_SUFFIX, '').replaceAll('.', '-');
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
  readonly disableDefaultTools: boolean;
}

interface ClaudeAuth {
  readonly apiKey: string;
  readonly authToken: string | undefined;
}

async function runClaudeAgent(invocation: HarnessInvocation): Promise<HarnessResult> {
  const {
    cwd,
    agentStateDir,
    model,
    provider,
    thinking,
    prompt,
    tools,
    credentials,
    customProvider,
    gitConfigGlobal,
    signal,
    onSessionEntry,
  } = invocation;
  const collector = new OutputCollector(invocation.outputs);

  if (signal.aborted) throw new Error('Agent step aborted before the Claude session started');
  if (agentStateDir === undefined) throw new Error('Agent state directory is required');
  // The server-issued per-step claude block is the discriminator for a managed
  // provider serving the anthropic-messages dialect; its provider ID (e.g.
  // "shipfox") is preserved for policy and usage attribution. The adapter is an
  // unvalidated surface for direct harness callers, so the block shape is
  // checked here rather than only at the runner DTO boundary.
  const claudeBlock = invocation.claude;
  if (claudeBlock !== undefined && !claudeRuntimeConfigSchema.safeParse(claudeBlock).success) {
    throw new AgentConfigError(
      'Harness "claude" received a malformed per-step claude runtime block.',
      'step_config_invalid',
    );
  }
  const providerUnsupported = provider !== 'anthropic' && claudeBlock === undefined;
  if (providerUnsupported) {
    const unsupportedReason = isReservedModelProviderId(provider)
      ? `Harness "claude" only supports provider "anthropic"; received "${provider}".`
      : `Harness "claude" requires the server-issued per-step claude runtime block for provider "${provider}"; the block was not present in this invocation.`;
    throw new AgentConfigError(unsupportedReason, 'provider_unsupported');
  }
  if (customProvider !== undefined) {
    throw new AgentConfigError(
      'Harness "claude" does not support custom model providers.',
      'provider_unsupported',
    );
  }

  const override = claudeAnthropicOverride(invocation.claude);
  const auth = claudeAuth(credentials, override);
  const targetUrl = override?.baseUrl ?? ANTHROPIC_API_URL;
  const targetLabel =
    invocation.claude !== undefined
      ? 'Claude Anthropic per-step endpoint'
      : override === undefined
        ? 'Claude Anthropic API endpoint'
        : 'Claude Anthropic base URL override';
  const hasDeclaredOutputs =
    invocation.outputs !== undefined && Object.keys(invocation.outputs).length > 0;
  const useOutputTools = hasDeclaredOutputs;
  const mcpServers = claudeMcpServers(invocation.mcpServers, collector, useOutputTools);

  await assertRunnerEgressAllowed(targetUrl, targetLabel);

  const effectiveModel = override?.model ?? model;
  const thinkingOptions = claudeThinkingOptions(effectiveModel, thinking);

  let configDir: string | undefined;
  let claudeQuery: Query | undefined;
  let messages: ClaudeInputStream | undefined;
  const controller = new AbortController();
  const abortQuery = () => {
    controller.abort();
    claudeQuery?.close();
  };

  try {
    configDir = await createClaudeConfigDir(agentStateDir);
    if (signal.aborted) throw new Error('Agent step aborted before the Claude session started');

    messages = new ClaudeInputStream();
    claudeQuery = query({
      prompt: messages,
      options: {
        model: effectiveModel,
        cwd,
        permissionMode: REQUESTED_PERMISSION_MODE,
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        strictMcpConfig: true,
        ...thinkingOptions,
        abortController: controller,
        ...claudeToolsOption(tools, override),
        ...claudeSystemPromptOption(),
        env: claudeEnvironment(auth, configDir, gitConfigGlobal, override),
        ...(mcpServers === undefined ? {} : {mcpServers}),
        persistSession: false,
        includePartialMessages: false,
      },
    });
    signal.addEventListener('abort', abortQuery, {once: true});
    if (signal.aborted) {
      abortQuery();
      throw new Error('Agent step aborted before the Claude session started');
    }

    let response = '';
    const queryIterator = claudeQuery[Symbol.asyncIterator]();
    try {
      await runOutputTurnLoop({
        signal,
        prompt: withClaudePromptGuidance(
          prompt,
          await repositoryInstructions(cwd),
          useOutputTools ? collector.guidanceText() : undefined,
        ),
        missingRequired: () => collector.missingRequired(),
        guidanceForMissing: (missing) => collector.guidanceTextFor(missing),
        runTurn: async (message) => {
          messages?.push(userMessage(message));
          response = (await readClaudeResult({queryIterator, onSessionEntry})).response ?? '';
        },
      });
    } catch (error) {
      if (error instanceof RequiredOutputsMissingError) {
        throw new AgentInvocationError(error.message, response);
      }
      throw error;
    }
    const outputs = collector.snapshot();
    return {
      response,
      ...(Object.keys(outputs).length === 0 ? {} : {outputs}),
    };
  } finally {
    messages?.close();
    signal.removeEventListener('abort', abortQuery);
    claudeQuery?.close();
    if (configDir !== undefined) await cleanupClaudeConfigDir(configDir);
  }
}

function claudeMcpServers(
  integrationMcpServers: HarnessInvocation['mcpServers'],
  collector: OutputCollector,
  useOutputTools: boolean,
) {
  const servers = Object.fromEntries(
    (integrationMcpServers ?? []).map((server) => [
      server.name,
      {type: 'sdk' as const, name: server.name, instance: server.server},
    ]),
  );
  if (useOutputTools) {
    servers.shipfox_outputs = createSdkMcpServer({
      name: 'shipfox_outputs',
      version: '1.0.0',
      instructions: collector.guidanceText(),
      tools: [setOutputTool(collector)],
      alwaysLoad: true,
    });
  }
  return Object.keys(servers).length === 0 ? undefined : servers;
}

function claudeToolsOption(
  tools: readonly string[] | undefined,
  override: ClaudeAnthropicOverride | undefined,
): {readonly tools?: string[]} {
  if (tools !== undefined) return {tools: [...tools]};
  return override?.disableDefaultTools === true ? {tools: []} : {};
}

function setOutputTool(collector: OutputCollector) {
  return tool(
    'set_output',
    'Set one structured output value for this workflow step.',
    {key: z.string(), value: z.string()},
    async (args) => {
      await Promise.resolve();
      const result = collector.trySet(args.key, args.value);
      return {
        content: [
          {
            type: 'text',
            text: result.ok ? `Output "${args.key}" set.` : result.feedback,
          },
        ],
      };
    },
    {alwaysLoad: true},
  );
}

async function readClaudeResult(params: {
  queryIterator: AsyncIterator<unknown>;
  onSessionEntry: ((line: string) => void) | undefined;
}): Promise<HarnessResult> {
  while (true) {
    const next = await params.queryIterator.next();
    if (next.done === true) break;
    const message = next.value;
    forwardSessionEntry(params.onSessionEntry, message);
    if (isInitMessage(message)) assertPermissionMode(message);
    if (!isResultMessage(message)) continue;
    return claudeResult(message);
  }

  throw new Error('Claude agent did not emit a result message.');
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
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: auth.apiKey,
    ...(auth.authToken !== undefined ? {ANTHROPIC_AUTH_TOKEN: auth.authToken} : {}),
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
  };
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
      disableDefaultTools: false,
    };
  }

  if (config.AGENT_CLAUDE_ANTHROPIC_BASE_URL === undefined) return undefined;

  return {
    baseUrl: config.AGENT_CLAUDE_ANTHROPIC_BASE_URL,
    model: config.AGENT_CLAUDE_ANTHROPIC_MODEL,
    smallFastModel: config.AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL,
    authToken: OLLAMA_ANTHROPIC_AUTH_TOKEN,
    disableDefaultTools: true,
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
