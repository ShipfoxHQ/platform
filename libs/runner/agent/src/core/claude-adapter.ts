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
  tool,
} from '@anthropic-ai/claude-agent-sdk';
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

export const claudeHarnessAdapter: HarnessAdapter = {run: runClaudeAgent};

interface ClaudeAnthropicOverride {
  readonly baseUrl: string;
  readonly model: string | undefined;
  readonly smallFastModel: string | undefined;
}

interface ClaudeAuth {
  readonly apiKey: string;
  readonly authToken: string | undefined;
}

async function runClaudeAgent(invocation: HarnessInvocation): Promise<HarnessResult> {
  const {
    cwd,
    logsDir,
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
  if (logsDir === undefined) throw new Error('Agent logs directory is required');
  if (provider !== 'anthropic') {
    throw new AgentConfigError(
      `Harness "claude" only supports provider "anthropic"; received "${provider}".`,
      'provider_unsupported',
    );
  }
  if (customProvider !== undefined) {
    throw new AgentConfigError(
      'Harness "claude" does not support custom model providers.',
      'provider_unsupported',
    );
  }

  const override = claudeAnthropicOverride();
  const auth = claudeAuth(credentials, override);
  const targetUrl = override?.baseUrl ?? ANTHROPIC_API_URL;
  const targetLabel =
    override === undefined ? 'Claude Anthropic API endpoint' : 'Claude Anthropic base URL override';
  const hasDeclaredOutputs =
    invocation.outputs !== undefined && Object.keys(invocation.outputs).length > 0;
  const useOutputTools = hasDeclaredOutputs;
  const mcpServers = claudeMcpServers(invocation.mcpServers, collector, useOutputTools);

  await assertRunnerEgressAllowed(targetUrl, targetLabel);

  let configDir: string | undefined;
  let claudeQuery: Query | undefined;
  let messages: ClaudeInputStream | undefined;
  const controller = new AbortController();
  const abortQuery = () => {
    controller.abort();
    claudeQuery?.close();
  };

  try {
    configDir = await createClaudeConfigDir(logsDir);
    if (signal.aborted) throw new Error('Agent step aborted before the Claude session started');

    messages = new ClaudeInputStream();
    claudeQuery = query({
      prompt: messages,
      options: {
        model: override?.model ?? model,
        cwd,
        permissionMode: REQUESTED_PERMISSION_MODE,
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        strictMcpConfig: true,
        thinking: {type: 'adaptive'},
        effort: thinking as EffortLevel,
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
  return override === undefined ? {} : {tools: []};
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

async function createClaudeConfigDir(logsDir: string): Promise<string> {
  await mkdir(logsDir, {recursive: true});
  return mkdtemp(join(logsDir, 'claude-config-'));
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

function claudeAnthropicOverride(): ClaudeAnthropicOverride | undefined {
  if (config.AGENT_CLAUDE_ANTHROPIC_BASE_URL === undefined) return undefined;

  return {
    baseUrl: config.AGENT_CLAUDE_ANTHROPIC_BASE_URL,
    model: config.AGENT_CLAUDE_ANTHROPIC_MODEL,
    smallFastModel: config.AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL,
  };
}

function claudeAuth(
  credentials: Record<string, string>,
  override: ClaudeAnthropicOverride | undefined,
): ClaudeAuth {
  if (override !== undefined) {
    return {apiKey: '', authToken: OLLAMA_ANTHROPIC_AUTH_TOKEN};
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
