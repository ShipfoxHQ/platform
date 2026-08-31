import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import {
  type CreateAgentSessionOptions,
  createAgentSessionFromServices,
  createAgentSessionServices,
  defineTool,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {
  type CustomAgentModelDto,
  type CustomModelProviderRuntimeConfigDto,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_INPUT_IMAGE,
  DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_MODEL_REASONING,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {Type} from 'typebox';
import {assertRunnerEgressAllowed} from '#core/egress.js';
import {
  AgentConfigError,
  AgentHarnessUnavailableError,
  AgentInvocationError,
  AgentSessionUnavailableError,
} from '#core/errors.js';
import type {HarnessAdapter, HarnessInvocation, HarnessResult} from '#core/harness.js';
import {
  OutputCollector,
  RequiredOutputsMissingError,
  runOutputTurnLoop,
  withOutputGuidance,
} from '#core/output-collector.js';
import {
  assertPiExtensionsLoaded,
  isPiExtensionAvailable,
  piExtensionDirectories,
} from '#core/pi-extensions.js';
import {type SessionForwarder, startSessionForwarder} from '#core/session-forwarder.js';
import {toolSelectionOption} from '#core/tool-selection.js';

const KEYLESS_CUSTOM_PROVIDER_API_KEY = 'shipfox-keyless-custom-provider-placeholder';
const SECRET_HEADER_CREDENTIAL_PREFIX = 'header:';
const PI_MCP_TOOL_NAME = 'mcp';

type PiThinkingLevel = NonNullable<CreateAgentSessionOptions['thinkingLevel']>;
type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>;
type PiSession = Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'];
type CustomProviderConfig = Parameters<ModelRuntimeInstance['registerProvider']>[1];
type CustomProviderModel = NonNullable<CustomProviderConfig['models']>[number];

export const piHarnessAdapter: HarnessAdapter = {run: runPiAgent};

/**
 * Runs the pi coding agent for one step. Resolves when the agent's turn completes and
 * throws on a pi/provider failure or abort, so the caller maps a resolved call to a
 * succeeded step and a thrown call to a failed step.
 *
 * The returned `response` is the agent's final assistant message, capped and reported
 * separately from structured outputs.
 */
async function runPiAgent(invocation: HarnessInvocation): Promise<HarnessResult> {
  assertPiInvocation(invocation);
  const {
    cwd,
    agentStateDir,
    session: invocationSession,
    thinking,
    prompt,
    tools,
    gitConfigGlobal,
    signal,
    onSessionEntry,
  } = invocation;
  const collector = new OutputCollector(invocation.outputs);
  const hasDeclaredOutputs =
    invocation.outputs !== undefined && Object.keys(invocation.outputs).length > 0;
  const customTools = hasDeclaredOutputs ? [setOutputTool(collector)] : [];

  // A listener added to an already-aborted signal never fires, so an abort that lands
  // before this point (or during the awaits below) would leave pi running and burning
  // tokens after the step loop has moved on. Guard on entry, then again once the
  // session exists so a mid-creation abort still stops pi.
  const {modelRuntime, model} = await preparePiModelRuntime(invocation);

  let session: PiSession | undefined;
  let mcpConfig: PiMcpConfig | undefined;

  try {
    mcpConfig = await createPiMcpConfig(agentStateDir, invocation.mcpServers);
    const prepared = await preparePiSessionServices({
      invocation,
      mcpConfig,
      modelRuntime,
    });
    session = await createPiSession({
      services: prepared.services,
      model,
      thinking,
      tools,
      customTools,
      mcpConfig,
      cwd,
      agentStateDir,
      sessionInvocation: invocationSession,
    });
    return await runPiSession({
      session,
      signal,
      mcpConfig,
      onSessionEntry,
      gitConfigGlobal,
      hasDeclaredOutputs,
      prompt,
      collector,
      sessionInvocation: invocationSession,
    });
  } finally {
    await closePiSession({session, mcpConfig});
  }
}

async function createPiSession(params: {
  services: Awaited<ReturnType<typeof createAgentSessionServices>>;
  model: ReturnType<typeof resolveModel>;
  thinking: string;
  tools: readonly string[] | undefined;
  customTools: ReturnType<typeof setOutputTool>[];
  mcpConfig: PiMcpConfig | undefined;
  cwd: string;
  agentStateDir: string;
  sessionInvocation: HarnessInvocation['session'];
}): Promise<PiSession> {
  const created = await createAgentSessionFromServices({
    services: params.services,
    model: params.model,
    thinkingLevel: params.thinking as PiThinkingLevel,
    ...toolSelectionOption(params.tools, [
      ...(params.mcpConfig === undefined ? [] : [PI_MCP_TOOL_NAME]),
      ...params.customTools.map((tool) => tool.name),
    ]),
    ...(params.customTools.length === 0 ? {} : {customTools: params.customTools}),
    sessionManager: createPiSessionManager(params),
  });
  return created.session;
}

async function runPiSession(params: {
  session: PiSession;
  signal: AbortSignal;
  mcpConfig: PiMcpConfig | undefined;
  onSessionEntry: HarnessInvocation['onSessionEntry'];
  gitConfigGlobal: string | undefined;
  hasDeclaredOutputs: boolean;
  prompt: string;
  collector: OutputCollector;
  sessionInvocation: HarnessInvocation['session'];
}): Promise<HarnessResult> {
  const abortSession = () => {
    Promise.resolve(params.session.abort()).catch(() => undefined);
  };
  if (params.signal.aborted) {
    abortSession();
    throw new Error('Agent step aborted during pi session creation');
  }
  params.signal.addEventListener('abort', abortSession, {once: true});
  try {
    return await runActivePiSession(params);
  } finally {
    params.signal.removeEventListener('abort', abortSession);
  }
}

async function runActivePiSession(
  params: Parameters<typeof runPiSession>[0],
): Promise<HarnessResult> {
  if (params.mcpConfig !== undefined) {
    await params.session.bindExtensions({
      mode: 'print',
      onError: (error) => logger().warn({err: error}, 'Pi extension failed'),
    });
  }
  if (params.signal.aborted) throw new Error('Agent step aborted during pi session creation');

  const forwarder = startForwarding(params.session.sessionFile, params.onSessionEntry);
  const stopForwarder = () => forwarder?.stop();
  params.signal.addEventListener('abort', stopForwarder, {once: true});
  const restoreGitConfigGlobal = createGitConfigGlobalRestorer(params.gitConfigGlobal);
  if (params.gitConfigGlobal) {
    process.env.GIT_CONFIG_GLOBAL = params.gitConfigGlobal;
    params.signal.addEventListener('abort', restoreGitConfigGlobal, {once: true});
  }
  try {
    return await runPiOutputTurns(params);
  } finally {
    forwarder?.stop();
    restoreGitConfigGlobal();
    params.signal.removeEventListener('abort', stopForwarder);
    params.signal.removeEventListener('abort', restoreGitConfigGlobal);
  }
}

async function runPiOutputTurns(
  params: Parameters<typeof runPiSession>[0],
): Promise<HarnessResult> {
  let response = '';
  try {
    await runOutputTurnLoop({
      signal: params.signal,
      prompt: params.hasDeclaredOutputs
        ? withOutputGuidance(params.prompt, params.collector.guidanceText())
        : params.prompt,
      runTurn: async (message) => {
        await params.session.prompt(message);
        const assistantError = lastAssistantError(params.session.messages);
        if (assistantError !== undefined) {
          throw new AgentInvocationError(
            assistantError,
            params.session.getLastAssistantText() ?? '',
          );
        }
        response = params.session.getLastAssistantText() ?? '';
      },
      missingRequired: () => params.collector.missingRequired(),
      guidanceForMissing: (missing) => params.collector.guidanceTextFor(missing),
    });
  } catch (error) {
    const response = params.session.getLastAssistantText() ?? '';
    if (error instanceof RequiredOutputsMissingError) {
      throw new AgentInvocationError(
        error.message,
        response,
        params.session.sessionFile,
        params.session.sessionId,
      );
    }
    if (error instanceof AgentInvocationError) {
      throw new AgentInvocationError(
        error.message,
        error.response,
        params.session.sessionFile,
        params.session.sessionId,
      );
    }
    throw new AgentInvocationError(
      error instanceof Error ? error.message : String(error),
      response,
      params.session.sessionFile,
      params.session.sessionId,
    );
  }
  const outputs = params.collector.snapshot();
  return {
    response,
    ...(Object.keys(outputs).length === 0 ? {} : {outputs}),
    ...(params.sessionInvocation === undefined || params.sessionInvocation.mode === 'fork'
      ? {}
      : {sessionFile: params.session.sessionFile}),
    ...(params.sessionInvocation === undefined || params.sessionInvocation.mode === 'fork'
      ? {}
      : {sessionId: params.session.sessionId}),
  };
}

function createPiSessionManager(
  params: Pick<
    Parameters<typeof createPiSession>[0],
    'cwd' | 'agentStateDir' | 'sessionInvocation'
  >,
): SessionManager {
  const sessionDirectory = join(params.agentStateDir, 'agent-sessions');
  if (params.sessionInvocation?.file === undefined) {
    return SessionManager.create(params.cwd, sessionDirectory);
  }
  return openHarnessSession({
    cwd: params.cwd,
    sessionFile: params.sessionInvocation.file,
    sessionDir: sessionDirectory,
    mode: params.sessionInvocation.mode,
  });
}

function assertPiInvocation(
  invocation: HarnessInvocation,
): asserts invocation is HarnessInvocation & {agentStateDir: string} {
  if (invocation.signal.aborted)
    throw new Error('Agent step aborted before the pi session started');
  if (invocation.agentStateDir === undefined) throw new Error('Agent state directory is required');
}

async function preparePiModelRuntime(
  invocation: HarnessInvocation,
): Promise<{modelRuntime: ModelRuntimeInstance; model: ReturnType<typeof resolveModel>}> {
  const modelRuntime = await ModelRuntime.create({
    credentials: createInMemoryCredentialStore(
      invocation.customProvider === undefined
        ? {
            [invocation.provider]: toPiRuntimeCredential(
              invocation.provider,
              invocation.credentials,
            ),
          }
        : {},
    ),
  });
  if (invocation.customProvider !== undefined) {
    await registerCustomProvider(
      modelRuntime,
      invocation.provider,
      invocation.credentials,
      invocation.customProvider,
    );
  }
  const model = resolveModel(modelRuntime, invocation.provider, invocation.model);
  if (!modelRuntime.hasConfiguredAuth(model.provider)) {
    throw new AgentConfigError(
      `No credentials configured for provider "${invocation.provider}". ` +
        'Verify the provider is configured for this workspace.',
      'provider_not_configured',
    );
  }
  return {modelRuntime, model};
}

async function preparePiSessionServices(params: {
  invocation: HarnessInvocation;
  mcpConfig: PiMcpConfig | undefined;
  modelRuntime: ModelRuntimeInstance;
}): Promise<{
  services: Awaited<ReturnType<typeof createAgentSessionServices>>;
}> {
  const {cwd, provider, model, thinking} = params.invocation;
  const {mcpConfig} = params;
  const extensionPackageNames = [
    ...(isPiExtensionAvailable({packageName: 'pi-web-access'}) ? ['pi-web-access'] : []),
    ...(mcpConfig === undefined ? [] : ['pi-mcp-adapter']),
  ];
  const extensionDirectories = resolvePiExtensionDirectories({
    cwd,
    provider,
    model,
    thinking,
    extensionPackageNames,
  });
  const services = await createAgentSessionServices({
    cwd,
    modelRuntime: params.modelRuntime,
    ...(mcpConfig === undefined
      ? {}
      : {extensionFlagValues: new Map([['mcp-config', mcpConfig.path]])}),
    resourceLoaderOptions: {additionalExtensionPaths: extensionDirectories},
  });
  const extensionResult = services.resourceLoader?.getExtensions?.();
  assertPiServiceDiagnostics(
    services.diagnostics,
    {
      cwd,
      provider,
      model,
      thinking,
      extensionPaths: extensionPackageNames,
      ...(extensionResult === undefined
        ? {}
        : {
            resolvedExtensionPaths: extensionResult.extensions.map(
              (extension) => extension.resolvedPath,
            ),
          }),
    },
    extensionResult?.errors,
  );
  assertPiExtensionsLoaded({
    resourceLoader: services.resourceLoader,
    directories: extensionDirectories,
  });
  return {services};
}

function resolvePiExtensionDirectories(params: {
  cwd: string;
  provider: string;
  model: string;
  thinking: string;
  extensionPackageNames: string[];
}): string[] {
  try {
    return piExtensionDirectories({packageNames: params.extensionPackageNames});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentHarnessUnavailableError({
      diagnostics: [{type: 'error', message}],
      environment: {
        cwd: params.cwd,
        provider: params.provider,
        model: params.model,
        thinking: params.thinking,
        extensionPaths: params.extensionPackageNames,
      },
    });
  }
}

function openHarnessSession(params: {
  cwd: string;
  sessionFile: string;
  sessionDir: string;
  mode: 'resume' | 'fork';
}): SessionManager {
  try {
    const manager = SessionManager.open(params.sessionFile, params.sessionDir, params.cwd);
    if (params.mode === 'fork') {
      manager.newSession({parentSession: params.sessionFile});
    }
    return manager;
  } catch (error) {
    throw new AgentSessionUnavailableError(
      `Pi could not load the agent session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

interface PiMcpConfig {
  readonly directory: string;
  readonly path: string;
}

function assertPiServiceDiagnostics(
  diagnostics: Awaited<ReturnType<typeof createAgentSessionServices>>['diagnostics'],
  environment: AgentHarnessUnavailableError['environment'],
  resourceLoaderErrors: AgentHarnessUnavailableError['resourceLoaderErrors'] = [],
): void {
  const errors = diagnostics.filter((diagnostic) => diagnostic.type === 'error');
  if (errors.length === 0 && resourceLoaderErrors.length === 0) return;
  throw new AgentHarnessUnavailableError({diagnostics, environment, resourceLoaderErrors});
}

function createInMemoryCredentialStore(credentials: Record<string, Credential>): CredentialStore {
  const values = new Map(Object.entries(credentials));
  return {
    read(providerId) {
      return Promise.resolve(values.get(providerId));
    },
    list(): Promise<readonly CredentialInfo[]> {
      return Promise.resolve(
        [...values.entries()].map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        })),
      );
    },
    async modify(providerId, update) {
      const next = await update(values.get(providerId));
      if (next !== undefined) values.set(providerId, next);
      return values.get(providerId);
    },
    delete(providerId) {
      values.delete(providerId);
      return Promise.resolve();
    },
  };
}

async function createPiMcpConfig(
  agentStateDir: string,
  mcpServers: HarnessInvocation['mcpServers'],
): Promise<PiMcpConfig | undefined> {
  if (mcpServers === undefined || mcpServers.length === 0) return undefined;

  await mkdir(agentStateDir, {recursive: true});
  const directory = await mkdtemp(join(agentStateDir, 'pi-mcp-'));
  const path = join(directory, 'mcp.json');
  try {
    const serverEntries = await Promise.all(
      mcpServers.map(async (server) => [
        server.name,
        {
          url: (await server.activateHttp()).toString(),
          auth: false,
          lifecycle: 'eager',
          exposeResources: false,
        },
      ]),
    );
    await writeFile(
      path,
      JSON.stringify({
        settings: {toolPrefix: 'none'},
        mcpServers: Object.fromEntries(serverEntries),
      }),
    );
    return {directory, path};
  } catch (error) {
    try {
      await rm(directory, {recursive: true, force: true});
    } catch (cleanupError) {
      logger().warn({err: cleanupError}, 'Failed to remove incomplete Pi MCP configuration');
    }
    throw error;
  }
}

async function closePiSession(params: {
  session: Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'] | undefined;
  mcpConfig: PiMcpConfig | undefined;
}): Promise<void> {
  const {session, mcpConfig} = params;
  if (session !== undefined) {
    try {
      await session.extensionRunner.emit({type: 'session_shutdown', reason: 'quit'});
    } catch (error) {
      logger().warn({err: error}, 'Failed to shut down Pi extensions');
    }
    try {
      session.dispose();
    } catch (error) {
      logger().warn({err: error}, 'Failed to dispose Pi session');
    }
  }
  if (mcpConfig !== undefined) {
    try {
      await rm(mcpConfig.directory, {recursive: true, force: true});
    } catch (error) {
      logger().warn({err: error}, 'Failed to remove Pi MCP configuration');
    }
  }
}

function lastAssistantError(messages: readonly unknown[]): string | undefined {
  const message = [...messages].reverse().find(isAssistantMessage);
  if (message === undefined || message.stopReason !== 'error') return undefined;
  return message.errorMessage ?? 'Agent provider returned an error.';
}

function isAssistantMessage(message: unknown): message is {
  readonly role: 'assistant';
  readonly stopReason?: string;
  readonly errorMessage?: string;
} {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    message.role === 'assistant'
  );
}

function setOutputTool(collector: OutputCollector) {
  return defineTool({
    name: 'set_output',
    label: 'Set output',
    description: 'Set one structured output value for this workflow step.',
    promptSnippet: 'set_output records a workflow step output.',
    promptGuidelines: [
      'Call set_output for each required workflow output; the exact key, value encoding, and JSON Schema for each are in the task prompt.',
    ],
    parameters: Type.Object({
      key: Type.String(),
      value: Type.String(),
    }),
    async execute(_toolCallId, params) {
      await Promise.resolve();
      const result = collector.trySet(params.key, params.value);
      return {
        content: [
          {
            type: 'text',
            text: result.ok ? `Output "${params.key}" set.` : result.feedback,
          },
        ],
        details: result,
      };
    },
  });
}

async function registerCustomProvider(
  modelRuntime: ModelRuntimeInstance,
  provider: string,
  credentials: Record<string, string>,
  customProvider: CustomModelProviderRuntimeConfigDto,
): Promise<void> {
  // Redirects and DNS changes after this point remain transport-layer SSRF
  // residuals until pi exposes per-request IP pinning hooks.
  await assertRunnerEgressAllowed(customProvider.base_url, 'Custom model provider endpoint');

  const apiKey = customProviderApiKey(provider, customProvider, credentials);

  try {
    modelRuntime.registerProvider(provider, {
      name: provider,
      baseUrl: customProvider.base_url,
      api: customProvider.api,
      apiKey,
      headers: customProviderHeaders(customProvider, credentials),
      models: customProvider.models.map((model) => toPiCustomProviderModel(customProvider, model)),
    });
  } catch (error) {
    throw new AgentConfigError(
      error instanceof Error && error.message.length > 0
        ? `Custom model provider "${provider}" is invalid: ${error.message}`
        : `Custom model provider "${provider}" is invalid.`,
      'step_config_invalid',
    );
  }
}

function customProviderApiKey(
  provider: string,
  customProvider: CustomModelProviderRuntimeConfigDto,
  credentials: Record<string, string>,
): string {
  const apiKey = credentials.api_key;
  if (!customProvider.requires_api_key) return KEYLESS_CUSTOM_PROVIDER_API_KEY;
  if (apiKey !== undefined && apiKey !== '') return apiKey;

  throw new AgentConfigError(
    `Custom model provider "${provider}" requires an API key but none was resolved.`,
    'credentials_invalid',
  );
}

function customProviderHeaders(
  customProvider: CustomModelProviderRuntimeConfigDto,
  credentials: Record<string, string>,
): Record<string, string> {
  const headers = Object.fromEntries(
    customProvider.headers.map((header) => [header.name, header.value]),
  );

  for (const name of customProvider.secret_header_names) {
    const value = credentials[`${SECRET_HEADER_CREDENTIAL_PREFIX}${name}`];
    if (value === undefined || value === '') continue;
    headers[name] = value;
  }

  return headers;
}

function toPiCustomProviderModel(
  customProvider: CustomModelProviderRuntimeConfigDto,
  model: CustomAgentModelDto,
): CustomProviderModel {
  const inputImage = model.input_image ?? DEFAULT_CUSTOM_MODEL_INPUT_IMAGE;
  const piModel: CustomProviderModel = {
    id: model.id,
    name: model.label,
    api: customProvider.api,
    reasoning: model.reasoning ?? DEFAULT_CUSTOM_MODEL_REASONING,
    input: inputImage ? ['text', 'image'] : ['text'],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    contextWindow: model.context_window ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens: model.max_output_tokens ?? DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
    ...(model.thinking_level_map === undefined ? {} : {thinkingLevelMap: model.thinking_level_map}),
    ...(model.compat === undefined ? {} : {compat: model.compat}),
  };
  return piModel;
}

function createGitConfigGlobalRestorer(gitConfigGlobal: string | undefined): () => void {
  let restored = false;
  const previous = process.env.GIT_CONFIG_GLOBAL;
  return () => {
    if (gitConfigGlobal === undefined || restored) return;
    restored = true;
    if (previous === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
      return;
    }
    process.env.GIT_CONFIG_GLOBAL = previous;
  };
}

function startForwarding(
  sessionFile: string | undefined,
  onSessionEntry: ((line: string) => void) | undefined,
): SessionForwarder | undefined {
  if (onSessionEntry === undefined || sessionFile === undefined) return undefined;
  return startSessionForwarder({filePath: sessionFile, onEntry: onSessionEntry});
}

type ResolvedModel = NonNullable<ReturnType<ModelRuntimeInstance['getModel']>>;

// pi's `find` returns undefined for both an unknown provider and a known provider that
// lacks the model, so split them on the registry's provider set to give an actionable
// message (and, when another provider carries the same id, a did-you-mean hint).
function resolveModel(
  modelRuntime: ModelRuntimeInstance,
  provider: string,
  modelId: string,
): ResolvedModel {
  const model = modelRuntime.getModel(provider, modelId);
  if (model) return model;

  const all = modelRuntime.getModels();
  const knownProviders = new Set(all.map((entry) => entry.provider));
  if (!knownProviders.has(provider)) {
    throw new AgentConfigError(
      `Unknown provider "${provider}" for agent step. ` +
        'Known providers are pi built-ins plus any from models.json.',
      'provider_unsupported',
    );
  }

  const alternativeProvider = all.find((entry) => entry.id === modelId)?.provider;
  const hint =
    alternativeProvider === undefined
      ? ''
      : ` Did you mean to set provider: ${alternativeProvider}?`;
  throw new AgentConfigError(
    `Model "${modelId}" is not available for provider "${provider}".${hint}`,
    'model_unavailable',
  );
}

function toPiRuntimeCredential(
  provider: string,
  credentials: Record<string, string>,
): ApiKeyCredential {
  const credential: ApiKeyCredential = {
    type: 'api_key',
    key: credentialValue(provider, credentials, 'api_key'),
  };
  const env = providerCredentialEnv(provider, credentials);
  return env === undefined ? credential : {...credential, env};
}

function providerCredentialEnv(
  provider: string,
  credentials: Record<string, string>,
): Record<string, string> | undefined {
  switch (provider) {
    case 'azure-openai-responses':
      return {AZURE_OPENAI_BASE_URL: credentialValue(provider, credentials, 'endpoint')};
    case 'cloudflare-ai-gateway':
      return {
        CLOUDFLARE_ACCOUNT_ID: credentialValue(provider, credentials, 'account_id'),
        CLOUDFLARE_GATEWAY_ID: credentialValue(provider, credentials, 'gateway_id'),
      };
    case 'cloudflare-workers-ai':
      return {CLOUDFLARE_ACCOUNT_ID: credentialValue(provider, credentials, 'account_id')};
    default:
      return undefined;
  }
}

function credentialValue(
  provider: string,
  credentials: Record<string, string>,
  key: string,
): string {
  const value = credentials[key];
  if (value === undefined || value === '') {
    throw new AgentConfigError(
      `Runtime credentials for provider "${provider}" are missing "${key}".`,
      'credentials_invalid',
    );
  }
  return value;
}
