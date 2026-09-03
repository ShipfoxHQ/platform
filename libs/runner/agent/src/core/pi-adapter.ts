import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
  ImageContent,
  TextContent,
} from '@earendil-works/pi-ai';
import {
  type AgentToolResult,
  type CreateAgentSessionOptions,
  createAgentSessionFromServices,
  createAgentSessionServices,
  defineTool,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {CallToolResult, ListToolsResult} from '@modelcontextprotocol/sdk/types.js';
import {
  agentIntegrationMcpToolName,
  type CustomAgentModelDto,
  type CustomModelProviderRuntimeConfigDto,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_INPUT_IMAGE,
  DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_MODEL_REASONING,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {Type} from 'typebox';
import {
  type AgentSessionCatalogFailure,
  AgentSessionDiagnostics,
  type AgentSessionToolDescriptor,
} from '#core/agent-session-diagnostics.js';
import {assertRunnerEgressAllowed} from '#core/egress.js';
import {
  AgentConfigError,
  AgentHarnessUnavailableError,
  AgentInvocationError,
  AgentSessionUnavailableError,
} from '#core/errors.js';
import type {
  HarnessAdapter,
  HarnessInvocation,
  HarnessResult,
  HarnessToolSurface,
} from '#core/harness.js';
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
import {createPiSessionDiagnosticsExtension} from '#core/pi-session-diagnostics.js';
import {createPiToolErrorNormalizerExtension} from '#core/pi-tool-error-normalizer.js';
import {createPiToolSvgNormalizerExtension} from '#core/pi-tool-svg-normalizer.js';
import {PrerequisiteLedger} from '#core/prerequisite-ledger.js';
import {type SessionForwarder, startSessionForwarder} from '#core/session-forwarder.js';
import {toolSelectionOption} from '#core/tool-selection.js';

const KEYLESS_CUSTOM_PROVIDER_API_KEY = 'shipfox-keyless-custom-provider-placeholder';
const SECRET_HEADER_CREDENTIAL_PREFIX = 'header:';
const PI_MCP_TOOL_NAME = 'mcp';
const PI_OUTPUT_TOOL_NAME = 'set_output';
const PI_BUILTIN_TOOL_NAMES = new Set([
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
  'mcp',
]);
const PI_MCP_METADATA_TIMEOUT_MS = 10_000;
const PI_MCP_CONFIG_ARG_WAIT_TIMEOUT_MS = 30_000;
const PI_MCP_METADATA_TIMEOUT_MESSAGE = 'Pi integration tool catalog lookup timed out.';
const CATALOG_TIMEOUT_PATTERN = /timed out|timeout/i;
const MAX_DIAGNOSTIC_STRING_LENGTH = 256;

let piMcpConfigArgTail = Promise.resolve();

type PiThinkingLevel = NonNullable<CreateAgentSessionOptions['thinkingLevel']>;
type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>;
type PiSession = Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'];
type PiSessionManagerSetup = {
  manager: SessionManager;
  forkedFromExistingSession: boolean;
};
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
  const prerequisiteLedger = new PrerequisiteLedger(invocation.prerequisites);
  const hasDeclaredOutputs =
    invocation.outputs !== undefined && Object.keys(invocation.outputs).length > 0;
  const toolSurface = resolvePiToolSurface(invocation);

  // A listener added to an already-aborted signal never fires, so an abort that lands
  // before this point (or during the awaits below) would leave pi running and burning
  // tokens after the step loop has moved on. Guard on entry, then again once the
  // session exists so a mid-creation abort still stops pi.
  const {modelRuntime, model} = await preparePiModelRuntime(invocation);

  let session: PiSession | undefined;
  let forkedFromExistingSession = false;
  let mcpConfig: PiMcpConfig | undefined;
  let customTools: ToolDefinition[] = [];
  let diagnostics: AgentSessionDiagnostics | undefined;

  try {
    const directTools =
      toolSurface === 'strict-direct'
        ? await createPiIntegrationToolCatalog(invocation, signal)
        : [];
    mcpConfig =
      toolSurface === 'discovery'
        ? await createPiMcpConfig(agentStateDir, invocation.mcpServers, signal)
        : undefined;
    const sessionDiagnostics = new AgentSessionDiagnostics({
      harness: 'pi',
      invocation,
      metadataMode: invocationSession?.mode === 'resume' ? 'warm' : 'cold',
      directToolNames: [
        ...directTools.map(({definition}) => definition.name),
        ...(mcpConfig?.directToolNames ?? []),
      ],
      proxyFallback: mcpConfig?.proxyFallback ?? false,
      providerTools: [
        ...directTools.map(({definition}) => piMcpToolDescriptor(definition)),
        ...(mcpConfig?.providerTools ?? []),
      ],
      catalogFailures: mcpConfig?.catalogFailures,
    });
    diagnostics = sessionDiagnostics;
    customTools = createPiCustomTools({
      collector,
      hasDeclaredOutputs,
      directTools,
    });
    const prepared = await preparePiSessionServices({
      invocation,
      mcpConfig,
      modelRuntime,
      hasDirectTools: directTools.length > 0,
      diagnostics: sessionDiagnostics,
    });
    const created = await createPiSession({
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
    session = created.session;
    forkedFromExistingSession = created.forkedFromExistingSession;
    return await runPiSession({
      session,
      signal,
      mcpConfig,
      onSessionEntry,
      gitConfigGlobal,
      hasDeclaredOutputs,
      prompt,
      collector,
      prerequisiteLedger,
      sessionInvocation: invocationSession,
      forkedFromExistingSession,
      diagnostics: sessionDiagnostics,
    });
  } catch (error) {
    if (invocationSession?.mode === 'fork') {
      await removeForkedSessionFile(session?.sessionFile);
    }
    throw error;
  } finally {
    await closePiSession({session, mcpConfig, diagnostics});
  }
}

async function createPiSession(params: {
  services: Awaited<ReturnType<typeof createAgentSessionServices>>;
  model: ReturnType<typeof resolveModel>;
  thinking: string;
  tools: readonly string[] | undefined;
  customTools: ToolDefinition[];
  mcpConfig: PiMcpConfig | undefined;
  cwd: string;
  agentStateDir: string;
  sessionInvocation: HarnessInvocation['session'];
}): Promise<{session: PiSession; forkedFromExistingSession: boolean}> {
  const sessionManagerSetup = createPiSessionManager(params);
  const sessionManager = sessionManagerSetup.manager;
  try {
    const created = await createAgentSessionFromServices({
      services: params.services,
      model: params.model,
      thinkingLevel: params.thinking as PiThinkingLevel,
      ...toolSelectionOption(params.tools, [
        ...params.customTools.map((tool) => tool.name),
        ...(params.mcpConfig === undefined
          ? []
          : [PI_MCP_TOOL_NAME, ...params.mcpConfig.directToolNames]),
      ]),
      ...(params.customTools.length === 0 ? {} : {customTools: params.customTools}),
      sessionManager,
    });
    if (params.tools === undefined && params.customTools.length > 0) {
      const customToolNames = new Set(params.customTools.map((tool) => tool.name));
      created.session.setActiveToolsByName([
        ...params.customTools.map((tool) => tool.name),
        ...created.session.getActiveToolNames().filter((name) => !customToolNames.has(name)),
      ]);
    }
    return {
      session: created.session,
      forkedFromExistingSession: sessionManagerSetup.forkedFromExistingSession,
    };
  } catch (error) {
    if (params.sessionInvocation?.mode === 'fork') {
      await removeForkedSessionFile(sessionManager.getSessionFile());
    }
    throw error;
  }
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
  prerequisiteLedger: PrerequisiteLedger;
  sessionInvocation: HarnessInvocation['session'];
  forkedFromExistingSession: boolean;
  diagnostics: AgentSessionDiagnostics;
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
  await params.session.bindExtensions({
    mode: 'print',
    onError: (error) => logger().warn({err: error}, 'Pi extension failed'),
  });
  installPiCompletionHooks(params);
  params.diagnostics.recordSessionId(params.session.sessionId);
  const registeredTools = params.session.getAllTools?.() ?? [];
  params.diagnostics.recordProviderTools(
    registeredTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  );
  if (params.signal.aborted) throw new Error('Agent step aborted during pi session creation');

  const forwarder = startForwarding(
    params.session.sessionFile,
    params.onSessionEntry,
    params.forkedFromExistingSession,
  );
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
  const sessionArtifact = resumablePiSessionArtifact(params.sessionInvocation, params.session);
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
      completionMissing: () => params.prerequisiteLedger.missing(),
      guidanceForMissing: (missing) => params.collector.guidanceTextFor(missing),
    });
    params.diagnostics.finish('completed');
  } catch (error) {
    throw wrapPiOutputError({
      error,
      response: params.session.getLastAssistantText() ?? '',
      sessionArtifact,
      diagnostics: params.diagnostics,
      aborted: params.signal.aborted,
    });
  }
  const outputs = params.collector.snapshot();
  return {
    response,
    ...(Object.keys(outputs).length === 0 ? {} : {outputs}),
    ...sessionArtifact,
  };
}

function wrapPiOutputError(params: {
  error: unknown;
  response: string;
  sessionArtifact: {sessionFile?: string; sessionId?: string};
  diagnostics: AgentSessionDiagnostics;
  aborted: boolean;
}): AgentInvocationError {
  if (params.error instanceof RequiredOutputsMissingError) {
    params.diagnostics.finish('required_output_missing', 'required_output_missing');
    return new AgentInvocationError(
      params.error.message,
      params.response,
      params.sessionArtifact.sessionFile,
      params.sessionArtifact.sessionId,
      'output_gate_failed',
    );
  }
  if (params.error instanceof AgentInvocationError) {
    params.diagnostics.finish(
      params.aborted ? 'aborted' : 'error',
      params.error.failurePhase === 'output_gate_failed' ? 'required_output_missing' : undefined,
    );
    return new AgentInvocationError(
      params.error.message,
      params.error.response,
      params.sessionArtifact.sessionFile,
      params.sessionArtifact.sessionId,
      params.error.failurePhase,
    );
  }
  params.diagnostics.finish(params.aborted ? 'aborted' : 'error');
  return new AgentInvocationError(
    params.error instanceof Error ? params.error.message : String(params.error),
    params.response,
    params.sessionArtifact.sessionFile,
    params.sessionArtifact.sessionId,
  );
}

function resumablePiSessionArtifact(
  sessionInvocation: HarnessInvocation['session'],
  session: PiSession,
): {sessionFile?: string; sessionId?: string} {
  if (sessionInvocation?.mode !== 'resume') return {};
  return {
    ...(session.sessionFile === undefined ? {} : {sessionFile: session.sessionFile}),
    ...(session.sessionId === undefined ? {} : {sessionId: session.sessionId}),
  };
}

function createPiSessionManager(
  params: Pick<
    Parameters<typeof createPiSession>[0],
    'cwd' | 'agentStateDir' | 'sessionInvocation'
  >,
): PiSessionManagerSetup {
  const sessionDirectory = join(params.agentStateDir, 'agent-sessions');
  if (params.sessionInvocation?.file === undefined) {
    return {
      manager: SessionManager.create(params.cwd, sessionDirectory),
      forkedFromExistingSession: false,
    };
  }
  if (params.sessionInvocation.mode === 'fork') {
    return forkHarnessSession({
      cwd: params.cwd,
      sessionFile: params.sessionInvocation.file,
      sessionDir: sessionDirectory,
    });
  }
  return {
    manager: openHarnessSession({
      cwd: params.cwd,
      sessionFile: params.sessionInvocation.file,
      sessionDir: sessionDirectory,
    }),
    forkedFromExistingSession: false,
  };
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
  hasDirectTools: boolean;
  diagnostics: AgentSessionDiagnostics;
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
  const services = await withPiMcpConfigArg(mcpConfig?.path, params.invocation.signal, () =>
    createAgentSessionServices({
      cwd,
      modelRuntime: params.modelRuntime,
      ...(mcpConfig === undefined
        ? {}
        : {extensionFlagValues: new Map([['mcp-config', mcpConfig.path]])}),
      resourceLoaderOptions: {
        additionalExtensionPaths: extensionDirectories,
        extensionFactories: [
          ...(mcpConfig === undefined && !params.hasDirectTools
            ? []
            : [createPiToolErrorNormalizerExtension()]),
          createPiToolSvgNormalizerExtension(),
          createPiSessionDiagnosticsExtension(params.diagnostics),
        ],
      },
    }),
  );
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

// pi-mcp-adapter resolves its config during module evaluation, before Pi applies
// extension flags. Session setup can overlap after an aborted run, so serialize this
// process-global mutation and keep the CLI-compatible flag visible only while extensions load.
async function withPiMcpConfigArg<T>(
  configPath: string | undefined,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  if (configPath === undefined) return operation();

  const previousOperation = piMcpConfigArgTail;
  let releaseOperation!: () => void;
  const operationSlot = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });
  // Keep the queue chained to the prior owner even when this waiter times out. This
  // lets later waiters fail fast without bypassing an operation that still owns argv.
  piMcpConfigArgTail = previousOperation.then(() => operationSlot);

  try {
    await waitForPiMcpConfigArg(previousOperation, signal);
    if (signal.aborted)
      throw signal.reason ?? new Error('Agent step aborted while waiting for Pi MCP setup');

    const originalArgs = process.argv.slice();
    const configFlagIndex = process.argv.indexOf('--mcp-config');
    if (configFlagIndex === -1) process.argv.push('--mcp-config', configPath);
    else if (configFlagIndex + 1 < process.argv.length)
      process.argv[configFlagIndex + 1] = configPath;
    else process.argv.push(configPath);

    try {
      return await operation();
    } finally {
      process.argv.splice(0, process.argv.length, ...originalArgs);
    }
  } finally {
    // A timed-out waiter releases its own queue slot, but never the operation that
    // still owns process.argv. The chained tail keeps later waiters behind that owner.
    releaseOperation();
  }
}

async function waitForPiMcpConfigArg(
  previousOperation: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(signal.reason ?? new Error('Agent step aborted while waiting for Pi MCP setup'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});
  });
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new AgentSessionUnavailableError(
            'Pi MCP configuration setup is blocked by another session.',
          ),
        ),
      PI_MCP_CONFIG_ARG_WAIT_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([previousOperation, aborted, timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
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
}): SessionManager {
  try {
    const manager = SessionManager.open(params.sessionFile, params.sessionDir, params.cwd);
    if (manager.getHeader() === null || manager.getEntries().length === 0) {
      throw new Error('session has no transcript entries');
    }
    return manager;
  } catch (error) {
    logSessionLoadFailure('resume', params.sessionFile, error);
    throw new AgentSessionUnavailableError(
      `Pi could not load the agent session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function forkHarnessSession(params: {
  cwd: string;
  sessionFile: string;
  sessionDir: string;
}): PiSessionManagerSetup {
  try {
    return {
      manager: SessionManager.forkFrom(params.sessionFile, params.cwd, params.sessionDir),
      forkedFromExistingSession: true,
    };
  } catch (error) {
    if (isMissingForkTranscript(error)) {
      return {
        manager: SessionManager.create(params.cwd, params.sessionDir),
        forkedFromExistingSession: false,
      };
    }
    logSessionLoadFailure('fork', params.sessionFile, error);
    throw new AgentSessionUnavailableError(
      `Pi could not load the agent session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isMissingForkTranscript(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('source session file is empty or invalid') ||
      error.message.includes('source session has no header'))
  );
}

function logSessionLoadFailure(mode: 'resume' | 'fork', sessionFile: string, error: unknown): void {
  logger().error(
    {event: 'runner.agent_session_load_failed', sessionMode: mode, sessionFile, err: error},
    'Agent session load failed',
  );
}

async function removeForkedSessionFile(sessionFile: string | undefined): Promise<void> {
  if (sessionFile === undefined) return;
  try {
    await rm(sessionFile, {force: true});
  } catch (error) {
    logger().warn({err: error, sessionFile}, 'Failed to remove incomplete Pi fork session');
  }
}

interface PiMcpConfig {
  readonly directory: string;
  readonly path: string;
  readonly directToolNames: readonly string[];
  readonly providerTools: readonly AgentSessionToolDescriptor[];
  readonly catalogFailures: readonly AgentSessionCatalogFailure[];
  readonly proxyFallback: boolean;
}

type PiMcpTool = ListToolsResult['tools'][number];
type PiMcpBridge = NonNullable<HarnessInvocation['mcpServers']>[number];

interface PiIntegrationTool {
  readonly bridge: PiMcpBridge;
  readonly definition: PiMcpTool;
}

function piMcpToolDescriptor(tool: PiMcpTool): AgentSessionToolDescriptor {
  return {
    name: tool.name,
    ...(tool.description === undefined ? {} : {description: tool.description}),
    inputSchema: tool.inputSchema,
    ...('outputSchema' in tool && tool.outputSchema !== undefined
      ? {outputSchema: tool.outputSchema}
      : {}),
  };
}

function resolvePiToolSurface(invocation: HarnessInvocation): HarnessToolSurface {
  return invocation.toolSurface ?? 'strict-direct';
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
  signal: AbortSignal,
): Promise<PiMcpConfig | undefined> {
  if (mcpServers === undefined || mcpServers.length === 0) return undefined;

  await mkdir(agentStateDir, {recursive: true});
  const directory = await mkdtemp(join(agentStateDir, 'pi-mcp-'));
  const path = join(directory, 'mcp.json');
  try {
    const preparedServers = await Promise.all(
      mcpServers.map(async (server) => {
        const [url, catalog] = await Promise.all([
          server.activateHttp(),
          listPiMcpTools(server, signal, false),
        ]);
        return {
          entry: [
            server.name,
            {
              url: url.toString(),
              auth: false,
              lifecycle: 'eager',
              directTools: true,
              exposeResources: false,
            },
          ] as const,
          directToolNames: catalog.tools.map((tool) => tool.name),
          providerTools: catalog.tools.map(piMcpToolDescriptor),
          ...(catalog.failure === undefined ? {} : {catalogFailure: catalog.failure}),
        };
      }),
    );
    await writeFile(
      path,
      JSON.stringify({
        settings: {toolPrefix: 'none'},
        mcpServers: Object.fromEntries(preparedServers.map((server) => server.entry)),
      }),
    );
    return {
      directory,
      path,
      directToolNames: preparedServers.flatMap((server) => server.directToolNames),
      providerTools: preparedServers.flatMap((server) => server.providerTools),
      catalogFailures: preparedServers.flatMap((server) =>
        server.catalogFailure === undefined ? [] : [server.catalogFailure],
      ),
      proxyFallback: true,
    };
  } catch (error) {
    try {
      await rm(directory, {recursive: true, force: true});
    } catch (cleanupError) {
      logger().warn({err: cleanupError}, 'Failed to remove incomplete Pi MCP configuration');
    }
    throw error;
  }
}

async function createPiIntegrationToolCatalog(
  invocation: HarnessInvocation,
  signal: AbortSignal,
): Promise<readonly PiIntegrationTool[]> {
  const mcpServers = invocation.mcpServers;
  if (mcpServers === undefined || mcpServers.length === 0) return [];

  const catalog = (
    await Promise.all(
      mcpServers.map(async (server) => {
        const catalog = await listPiMcpTools(server, signal, true);
        return catalog.tools.map((definition) => ({bridge: server, definition}));
      }),
    )
  ).flat();

  const byName = new Map<string, PiIntegrationTool>();
  for (const tool of catalog) {
    if (byName.has(tool.definition.name)) {
      throw integrationToolCatalogUnavailable(
        tool.bridge.name,
        new Error(`Duplicate integration tool name "${tool.definition.name}".`),
      );
    }
    byName.set(tool.definition.name, tool);
  }

  const requestedTools = invocation.requestedIntegrationTools;
  if (requestedTools === undefined) return catalog;

  const requestedNames = requestedTools.map(({connectionSlug, toolId}) =>
    agentIntegrationMcpToolName(connectionSlug, toolId),
  );
  const requestedNameSet = new Set<string>();
  const selected: PiIntegrationTool[] = [];
  for (const name of requestedNames) {
    if (requestedNameSet.has(name)) {
      throw integrationToolCatalogUnavailable(
        mcpServers[0]?.name ?? 'shipfox_integration_tools',
        new Error(`Duplicate requested integration tool "${name}".`),
      );
    }
    requestedNameSet.add(name);
    const tool = byName.get(name);
    if (tool === undefined) {
      throw integrationToolCatalogUnavailable(
        mcpServers[0]?.name ?? 'shipfox_integration_tools',
        new Error(`Requested integration tool "${name}" was not advertised.`),
      );
    }
    selected.push(tool);
  }
  return selected;
}

async function listPiMcpTools(
  server: PiMcpBridge,
  signal: AbortSignal,
  failClosed: boolean,
): Promise<{
  readonly tools: readonly PiMcpTool[];
  readonly failure?: AgentSessionCatalogFailure | undefined;
}> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  const timeout = setTimeout(
    () => controller.abort(new Error(PI_MCP_METADATA_TIMEOUT_MESSAGE)),
    PI_MCP_METADATA_TIMEOUT_MS,
  );
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, {once: true});

  try {
    const result = await server.listTools({
      signal: controller.signal,
      timeout: PI_MCP_METADATA_TIMEOUT_MS,
    });
    return {
      tools: result.tools,
    };
  } catch (error) {
    if (signal.aborted) throw error;
    const status = catalogErrorStatus(error);
    const errorClass = catalogErrorClass(error, status, controller.signal.aborted);
    if (failClosed) throw integrationToolCatalogUnavailable(server.name, error);
    logger().warn(
      {
        event: 'runner.agent_pi_tool_catalog_unavailable',
        server: boundedDiagnosticString(server.name),
        errorClass,
        ...(status === undefined ? {} : {status}),
      },
      'Failed to list Pi MCP direct tools; keeping the MCP proxy fallback',
    );
    return {
      tools: [],
      failure: {
        server: server.name,
        errorClass,
        ...(status === undefined ? {} : {status}),
      },
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

function integrationToolCatalogUnavailable(
  serverName: string,
  error: unknown,
): AgentInvocationError {
  const reason = error instanceof Error ? error.message : String(error);
  return new AgentInvocationError(
    `Pi integration tool catalog unavailable for "${serverName}": ${reason}`,
    undefined,
    undefined,
    undefined,
    'integration_tool_catalog_unavailable',
  );
}

function integrationToolDefinition(tool: PiIntegrationTool): ToolDefinition {
  const {definition} = tool;
  const description = definition.description?.trim() || `Integration tool ${definition.name}.`;
  return defineTool({
    name: definition.name,
    label: `Integration: ${definition.name}`,
    description: `${description} Call this direct tool by name; do not route it through mcp.`,
    promptSnippet: `Direct integration tool ${definition.name}.`,
    parameters: Type.Unsafe(definition.inputSchema as never),
    async execute(_toolCallId, params) {
      const result = await tool.bridge.callTool(definition.name, params as Record<string, unknown>);
      return {
        content: piToolContent(result.content),
        details: result,
      };
    },
  });
}

function createPiCustomTools(params: {
  collector: OutputCollector;
  hasDeclaredOutputs: boolean;
  directTools: readonly PiIntegrationTool[];
}): ToolDefinition[] {
  let directToolDefinitions: ToolDefinition[];
  try {
    directToolDefinitions = params.directTools.map((tool) => {
      if (PI_BUILTIN_TOOL_NAMES.has(tool.definition.name)) {
        throw new Error(
          `Integration tool name collides with Pi built-in tool "${tool.definition.name}".`,
        );
      }
      return integrationToolDefinition(tool);
    });
  } catch (error) {
    throw integrationToolCatalogUnavailable(
      params.directTools[0]?.bridge.name ?? 'shipfox_integration_tools',
      error,
    );
  }
  const customTools = [
    ...(params.hasDeclaredOutputs ? [setOutputTool(params.collector)] : []),
    ...directToolDefinitions,
  ];
  const names = new Set<string>();
  for (const tool of customTools) {
    if (names.has(tool.name)) {
      throw integrationToolCatalogUnavailable(
        'shipfox_integration_tools',
        new Error(`Integration tool name collides with SDK custom tool "${tool.name}".`),
      );
    }
    names.add(tool.name);
  }
  return customTools;
}

function piToolContent(content: CallToolResult['content']): AgentToolResult<unknown>['content'] {
  return content.map((block) => {
    if (block.type === 'text') return block as TextContent;
    if (block.type === 'image') return block as ImageContent;
    return {
      type: 'text' as const,
      text: JSON.stringify(block) ?? String(block),
    };
  });
}

function catalogErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.status ?? error.statusCode ?? error.code;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

function boundedDiagnosticString(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_STRING_LENGTH
    ? value
    : value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH);
}

function catalogErrorClass(
  error: unknown,
  status: number | undefined,
  timedOut: boolean,
): AgentSessionCatalogFailure['errorClass'] {
  if (status !== undefined) return 'http';
  if (timedOut) return 'timeout';
  if (error instanceof Error && CATALOG_TIMEOUT_PATTERN.test(error.message)) return 'timeout';
  if (error instanceof TypeError) return 'transport';
  return 'unknown';
}

async function closePiSession(params: {
  session: Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'] | undefined;
  mcpConfig: PiMcpConfig | undefined;
  diagnostics: AgentSessionDiagnostics | undefined;
}): Promise<void> {
  const {session, mcpConfig, diagnostics} = params;
  diagnostics?.finish(diagnostics.terminationReason ?? 'error');
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

function installPiCompletionHooks(params: Parameters<typeof runPiSession>[0]): void {
  const agent = (params.session as PiSession & {agent?: PiSession['agent']}).agent;
  if (agent === undefined) return;

  const previousAfterToolCall = agent.afterToolCall;
  agent.afterToolCall = async (context, signal) => {
    const rejectedOutput =
      context.toolCall.name === 'set_output' && isRejectedOutputDetails(context.result.details);
    const previousResult = await previousAfterToolCall?.(context, signal);
    const isError = context.isError || previousResult?.isError === true;
    if (!isError && !rejectedOutput) {
      const toolCall = prerequisiteToolCall(
        context.toolCall.name,
        context.args,
        context.result.details,
      );
      if (toolCall !== undefined) {
        params.prerequisiteLedger.recordToolSuccess(toolCall.toolName, toolCall.args);
      }
    }
    return rejectedOutput ? {...previousResult, isError: true} : previousResult;
  };
  agent.shouldStopAfterTurn = () =>
    (params.hasDeclaredOutputs || params.prerequisiteLedger.hasRequirements()) &&
    params.collector.isComplete() &&
    params.prerequisiteLedger.isComplete();
}

function isRejectedOutputDetails(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

function prerequisiteToolCall(
  toolName: string,
  args: unknown,
  details: unknown,
): {readonly toolName: string; readonly args: unknown} | undefined {
  if (toolName !== PI_MCP_TOOL_NAME) return {toolName, args};
  if (!isRecord(args) || typeof args.tool !== 'string') return undefined;
  if (!isRecord(details) || typeof details.tool !== 'string') return undefined;

  return {
    toolName: details.tool,
    args: parseMcpProxyArgs(args.args),
  };
}

function parseMcpProxyArgs(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function setOutputTool(collector: OutputCollector) {
  return defineTool({
    name: PI_OUTPUT_TOOL_NAME,
    label: 'Set output',
    description:
      'Set one structured output value directly with set_output({key: "summary", value: "..."}). Do not route set_output through mcp.',
    promptSnippet: 'Call set_output directly to record a workflow step output.',
    promptGuidelines: [
      'Call set_output({key: "<output-key>", value: "<value>"}) directly for each required workflow output; do not call it through mcp. The exact key, value encoding, and JSON Schema for each are in the task prompt.',
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
  skipExistingEntries = false,
): SessionForwarder | undefined {
  if (onSessionEntry === undefined || sessionFile === undefined) return undefined;
  return startSessionForwarder({
    filePath: sessionFile,
    onEntry: onSessionEntry,
    startAtEnd: skipExistingEntries,
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
