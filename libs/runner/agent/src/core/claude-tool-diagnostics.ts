import {
  AGENT_INTEGRATION_MCP_SERVER_NAME,
  agentIntegrationMcpToolName,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type AgentSessionCatalogFailure,
  type AgentSessionDiagnosticStoreEntry,
  AgentSessionDiagnostics,
  type AgentSessionFailureClass,
  type AgentSessionMetadataMode,
  type AgentSessionTerminationReason,
  type AgentSessionToolDescriptor,
} from '#core/agent-session-diagnostics.js';
import type {AgentInvocationFailurePhase} from '#core/errors.js';
import type {HarnessInvocation, RequestedIntegrationTool} from '#core/harness.js';

export type ClaudeToolOmissionReason =
  | 'catalog_resolution'
  | 'runner_capability'
  | 'connection_policy'
  | 'sdk_registration';

export type ClaudeToolOutputGate = 'not_required' | 'passed' | 'failed' | 'not_evaluated';

export interface ClaudeToolOmission {
  readonly toolName: string;
  readonly reason: ClaudeToolOmissionReason;
}

export type ClaudeToolCatalogFailureReason = Extract<
  ClaudeToolOmissionReason,
  'catalog_resolution' | 'connection_policy'
>;

export type ClaudeToolCatalogErrorClass = 'http' | 'timeout' | 'transport' | 'unknown';

export interface ClaudeToolCatalogFailure {
  readonly server: string;
  readonly reason: ClaudeToolCatalogFailureReason;
  readonly errorClass: ClaudeToolCatalogErrorClass;
  readonly errorStatus?: number;
}

interface ClaudeToolDiagnosticsParams {
  readonly invocation: Pick<
    HarnessInvocation,
    'jobExecutionId' | 'stepId' | 'attempt' | 'provider' | 'model' | 'session'
  >;
  readonly requestedTools: readonly RequestedIntegrationTool[];
  readonly resolvedToolNames?: readonly string[];
  readonly expectedSdkToolNames?: readonly string[];
  readonly sdkToolToIntegrationTool?: ReadonlyMap<string, string>;
  readonly selectedToolNames?: readonly string[] | undefined;
  readonly omissions?: readonly ClaudeToolOmission[];
  readonly catalogFailures?: readonly ClaudeToolCatalogFailure[];
  readonly providerTools?: readonly AgentSessionToolDescriptor[] | undefined;
  readonly metadataMode?: AgentSessionMetadataMode | undefined;
  readonly directToolNames?: readonly string[] | undefined;
  readonly proxyFallback?: boolean | undefined;
  readonly requiredOutputCount: number;
}

const MAX_DIAGNOSTIC_ENTRIES = 100;
const MAX_DIAGNOSTIC_STRING_LENGTH = 256;

export class ClaudeToolDiagnostics {
  readonly #jobExecutionId: string;
  readonly #stepId: string;
  readonly #attempt: number;
  readonly #requestedToolNames: readonly string[];
  readonly #resolvedToolNames: readonly string[];
  readonly #expectedSdkToolNames: ReadonlySet<string>;
  readonly #requestedSdkToolNames: ReadonlySet<string>;
  readonly #sdkToolToIntegrationTool: ReadonlyMap<string, string>;
  readonly #selectedToolNames: readonly string[] | undefined;
  readonly #catalogFailures: readonly ClaudeToolCatalogFailure[];
  readonly #sessionDiagnostics: AgentSessionDiagnostics;
  readonly #omissions = new Map<string, ClaudeToolOmissionReason>();
  readonly #requiredOutputCount: number;
  readonly #advertisedToolNames = new Set<string>();
  readonly #advertisedSdkToolNames = new Set<string>();
  readonly #attemptedToolNames = new Set<string>();
  readonly #failedToolNames = new Set<string>();
  readonly #toolUseIds = new Map<string, string>();
  readonly #diagnosticToolUseIds = new Set<string>();
  #advertisementObserved = false;
  #sdkToolListObserved = false;
  #outcomeLogged = false;
  #sessionDiagnosticsAppended = false;
  #failurePhase: AgentInvocationFailurePhase | undefined;

  constructor(params: ClaudeToolDiagnosticsParams) {
    this.#jobExecutionId = params.invocation.jobExecutionId ?? 'unknown';
    this.#stepId = params.invocation.stepId ?? 'unknown';
    this.#attempt = params.invocation.attempt ?? 0;
    const requestedToolNames = uniqueStrings(
      params.requestedTools.map((tool) => integrationToolName(tool)),
    );
    this.#requestedToolNames = requestedToolNames;
    this.#resolvedToolNames = uniqueStrings(params.resolvedToolNames ?? []);
    const expectedSdkToolNames =
      params.expectedSdkToolNames ?? requestedToolNames.map((name) => claudeSdkToolName(name));
    this.#expectedSdkToolNames = new Set(expectedSdkToolNames);
    this.#requestedSdkToolNames = new Set(
      this.#requestedToolNames.map((name) => claudeSdkToolName(name)),
    );
    this.#sdkToolToIntegrationTool =
      params.sdkToolToIntegrationTool ??
      new Map(this.#requestedToolNames.map((name) => [claudeSdkToolName(name), name]));
    this.#selectedToolNames = params.selectedToolNames;
    this.#catalogFailures = (params.catalogFailures ?? []).slice(0, MAX_DIAGNOSTIC_ENTRIES);
    this.#requiredOutputCount = params.requiredOutputCount;
    this.#sessionDiagnostics = new AgentSessionDiagnostics({
      harness: 'claude',
      invocation: params.invocation,
      metadataMode:
        params.metadataMode ?? (params.invocation.session?.mode === 'resume' ? 'warm' : 'cold'),
      directToolNames: params.directToolNames,
      proxyFallback: params.proxyFallback,
      providerTools: params.providerTools,
      catalogFailures: (params.catalogFailures ?? []).map(catalogFailureForSession),
    });
    if (params.invocation.session?.harnessSessionId !== undefined) {
      this.#sessionDiagnostics.recordSessionId(params.invocation.session.harnessSessionId);
    }
    for (const omission of params.omissions ?? []) {
      this.#addOmission(omission.toolName, omission.reason);
    }
  }

  get failurePhase(): AgentInvocationFailurePhase | undefined {
    return this.#failurePhase;
  }

  get sessionDiagnostics(): AgentSessionDiagnostics {
    return this.#sessionDiagnostics;
  }

  recordTurnStart(): void {
    this.#sessionDiagnostics.recordTurnStart();
  }

  recordPreparationFailure(reason: ClaudeToolOmissionReason): void {
    for (const toolName of this.#requestedToolNames) this.#addOmission(toolName, reason);
  }

  logManifest(): void {
    if (!this.#hasIntegrationTools()) return;
    safeLog(
      {
        event: 'runner.agent_claude_tool_manifest',
        harness: 'claude',
        jobExecutionId: this.#jobExecutionId,
        stepId: this.#stepId,
        attempt: this.#attempt,
        requestedIntegrationToolCount: this.#requestedToolNames.length,
        requestedIntegrationToolIds: boundedStrings(this.#requestedToolNames),
        resolvedIntegrationToolCount: this.#resolvedToolNames.length,
        resolvedIntegrationToolNames: boundedStrings(this.#resolvedToolNames),
        sdkToolNames: boundedStrings([...this.#expectedSdkToolNames]),
        selectedToolCount: this.#selectedToolNames?.length,
        selectedToolNames:
          this.#selectedToolNames === undefined
            ? undefined
            : boundedStrings(this.#selectedToolNames),
        catalogFailures: this.#catalogFailures.map((failure) => ({
          server: truncate(failure.server),
          reason: failure.reason,
          errorClass: failure.errorClass,
          ...(failure.errorStatus === undefined ? {} : {errorStatus: failure.errorStatus}),
        })),
        omissions: this.#omissionEntries(),
      },
      'Claude integration tool manifest',
    );
  }

  recordMessage(message: unknown): void {
    if (isRecord(message)) this.#sessionDiagnostics.recordUsage(message.usage);
    if (isInitMessage(message)) {
      this.#recordInit(message);
      return;
    }
    if (!isRecord(message)) return;

    if (message.type === 'tool_progress') {
      this.#recordToolUse(message.tool_name, message.tool_use_id, undefined);
      return;
    }
    if (message.type === 'assistant') {
      this.#recordAssistantToolUses(message.message);
      return;
    }
    if (message.type === 'user') this.#recordToolResults(message.message);
  }

  finish(params: {
    outputGate: ClaudeToolOutputGate;
    missingOutputCount?: number;
    executionFailed?: boolean;
    executionCompleted?: boolean;
    aborted?: boolean;
  }): AgentInvocationFailurePhase | undefined {
    if (this.#outcomeLogged) return this.#failurePhase;
    this.#outcomeLogged = true;
    if (params.executionFailed !== true && !this.#sdkToolListObserved) {
      this.#recordSdkRegistrationOmissions();
    }
    this.#failurePhase = this.#classify(params);
    const failureClass = this.#sessionFailureClass(params);
    if (failureClass !== undefined) this.#sessionDiagnostics.markFailure(failureClass);
    this.#sessionDiagnostics.finish(sessionTerminationReason(params, failureClass), failureClass);
    if (!this.#hasIntegrationTools()) return this.#failurePhase;

    safeLog(
      {
        event: 'runner.agent_claude_tool_outcome',
        harness: 'claude',
        jobExecutionId: this.#jobExecutionId,
        stepId: this.#stepId,
        attempt: this.#attempt,
        failurePhase: this.#failurePhase ?? 'none',
        outputGate: params.outputGate,
        requiredOutputCount: this.#requiredOutputCount,
        missingOutputCount: params.missingOutputCount ?? 0,
        advertisementObserved: this.#advertisementObserved,
        advertisedClaudeSdkToolNames: boundedStrings([...this.#advertisedSdkToolNames]),
        advertisedIntegrationToolCount: this.#advertisedToolNames.size,
        advertisedIntegrationToolNames: boundedStrings([...this.#advertisedToolNames]),
        attemptedIntegrationToolCount: this.#attemptedToolNames.size,
        attemptedIntegrationToolNames: boundedStrings([...this.#attemptedToolNames]),
        failedIntegrationToolCount: this.#failedToolNames.size,
        failedIntegrationToolNames: boundedStrings([...this.#failedToolNames]),
        catalogFailures: this.#catalogFailures.map((failure) => ({
          server: truncate(failure.server),
          reason: failure.reason,
          errorClass: failure.errorClass,
          ...(failure.errorStatus === undefined ? {} : {errorStatus: failure.errorStatus}),
        })),
        omissions: this.#omissionEntries(),
      },
      'Claude integration tool outcome',
    );
    return this.#failurePhase;
  }

  recordOutputWrite(params: {
    key: string;
    value: string;
    result: {
      readonly ok: boolean;
      readonly idempotent?: boolean | undefined;
      readonly code?: string | undefined;
      readonly reason?: string | undefined;
    };
  }): void {
    this.#sessionDiagnostics.recordOutputWrite(params);
  }

  async appendToSessionStore(
    sessionStore:
      | {
          append(
            key: {projectKey: string; sessionId: string},
            entries: AgentSessionDiagnosticStoreEntry[],
          ): Promise<void>;
        }
      | undefined,
    sessionId: string | undefined,
  ): Promise<void> {
    if (this.#sessionDiagnosticsAppended || sessionStore === undefined || sessionId === undefined) {
      return;
    }
    try {
      await sessionStore.append({projectKey: '', sessionId}, [
        this.#sessionDiagnostics.storeEntry(),
      ]);
      this.#sessionDiagnosticsAppended = true;
    } catch {
      safeLog(
        {
          event: 'runner.agent_session_diagnostics_persist_failed',
          harness: 'claude',
        },
        'Claude session diagnostics could not be appended to the protected transcript',
      );
    }
  }

  #recordInit(message: Record<string, unknown>): void {
    this.#advertisementObserved = true;
    if (typeof message.session_id === 'string') {
      this.#sessionDiagnostics.recordSessionId(message.session_id);
    }
    if (!Array.isArray(message.tools)) return;
    this.#sdkToolListObserved = true;
    const advertised = new Set(
      message.tools.filter((tool): tool is string => typeof tool === 'string'),
    );
    this.#sessionDiagnostics.recordProviderToolNames([...advertised]);
    for (const toolName of this.#expectedSdkToolNames) {
      const integrationName = this.#sdkToolToIntegrationTool.get(toolName);
      if (integrationName === undefined) continue;
      if (advertised.has(toolName)) {
        this.#omissions.delete(integrationName);
        this.#advertisedSdkToolNames.add(toolName);
        this.#advertisedToolNames.add(integrationName);
      } else if (!this.#omissions.has(integrationName)) {
        this.#addOmission(integrationName, 'sdk_registration');
      }
    }
  }

  #recordAssistantToolUses(message: unknown): void {
    if (!isRecord(message) || !Array.isArray(message.content)) return;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_use') continue;
      this.#recordToolUse(block.name, block.id, block.input);
    }
  }

  #recordToolResults(message: unknown): void {
    if (!isRecord(message) || !Array.isArray(message.content)) return;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_result') continue;
      if (typeof block.tool_use_id !== 'string') continue;
      const toolName = this.#toolUseIds.get(block.tool_use_id);
      if (block.is_error === true && toolName !== undefined) this.#failedToolNames.add(toolName);
      this.#sessionDiagnostics.recordToolResult({
        toolCallId: block.tool_use_id,
        ...(toolName === undefined ? {} : {toolName}),
        isError: block.is_error === true,
        details: block,
        structuredContent: structuredClaudeToolResult(block.content),
      });
    }
  }

  #recordToolUse(name: unknown, toolUseId: unknown, input: unknown): void {
    if (typeof name !== 'string' || !this.#expectedSdkToolNames.has(name)) return;
    const integrationName = this.#sdkToolToIntegrationTool.get(name);
    if (integrationName === undefined) return;
    this.#omissions.delete(integrationName);
    this.#attemptedToolNames.add(integrationName);
    if (typeof toolUseId === 'string') {
      this.#toolUseIds.set(toolUseId, integrationName);
      if (!this.#diagnosticToolUseIds.has(toolUseId)) {
        this.#diagnosticToolUseIds.add(toolUseId);
        this.#sessionDiagnostics.recordToolCall({
          toolCallId: toolUseId,
          toolName: integrationName,
          args: input === undefined ? {} : input,
        });
      } else if (input !== undefined) {
        this.#sessionDiagnostics.updateToolCallArguments(toolUseId, input);
      }
    }
  }

  #classify(params: {
    outputGate: ClaudeToolOutputGate;
    executionFailed?: boolean;
    executionCompleted?: boolean;
  }): AgentInvocationFailurePhase | undefined {
    if (params.outputGate === 'failed') return 'output_gate_failed';
    if (this.#failedToolNames.size > 0) return 'integration_tool_invocation_failed';
    if (
      params.executionFailed === true &&
      params.executionCompleted !== true &&
      this.#attemptedToolNames.size > 0
    ) {
      return 'integration_tool_invocation_failed';
    }
    if (this.#omissions.size > 0) return 'requested_tool_omitted';
    if (
      this.#requestedSdkToolNames.size > 0 &&
      [...this.#requestedSdkToolNames].some((toolName) => {
        const integrationName = this.#sdkToolToIntegrationTool.get(toolName);
        return (
          integrationName !== undefined &&
          this.#advertisedToolNames.has(integrationName) &&
          !this.#attemptedToolNames.has(integrationName)
        );
      })
    ) {
      return 'advertised_tool_not_invoked';
    }
    return undefined;
  }

  #sessionFailureClass(params: {
    outputGate: ClaudeToolOutputGate;
    executionFailed?: boolean;
  }): AgentSessionFailureClass | undefined {
    if (params.outputGate === 'failed') return 'required_output_missing';
    const observed = this.#sessionDiagnostics.failureClasses[0];
    if (observed !== undefined) return observed;
    if (params.executionFailed === true && this.#catalogFailures.length > 0) {
      return 'integration_tool_catalog_unavailable';
    }
    return undefined;
  }

  #addOmission(toolName: string, reason: ClaudeToolOmissionReason): void {
    if (!this.#requestedToolNames.includes(toolName) || this.#omissions.has(toolName)) return;
    this.#omissions.set(toolName, reason);
  }

  #recordSdkRegistrationOmissions(): void {
    for (const sdkName of this.#requestedSdkToolNames) {
      const integrationName = this.#sdkToolToIntegrationTool.get(sdkName);
      if (integrationName !== undefined) this.#addOmission(integrationName, 'sdk_registration');
    }
  }

  #omissionEntries(): readonly ClaudeToolOmission[] {
    return [...this.#omissions.entries()]
      .slice(0, MAX_DIAGNOSTIC_ENTRIES)
      .map(([toolName, reason]) => ({toolName: truncate(toolName), reason}));
  }

  #hasIntegrationTools(): boolean {
    return (
      this.#requestedToolNames.length > 0 ||
      this.#resolvedToolNames.length > 0 ||
      this.#expectedSdkToolNames.size > 0 ||
      this.#omissions.size > 0
    );
  }
}

function sessionTerminationReason(
  params: {outputGate: ClaudeToolOutputGate; executionFailed?: boolean; aborted?: boolean},
  failureClass: AgentSessionFailureClass | undefined,
): AgentSessionTerminationReason {
  if (params.aborted === true) return 'aborted';
  if (params.executionFailed === true) return failureClass ?? 'error';
  return params.outputGate === 'failed' ? 'error' : 'completed';
}

export function integrationToolName(tool: RequestedIntegrationTool): string {
  return agentIntegrationMcpToolName(tool.connectionSlug, tool.toolId);
}

export function claudeSdkToolName(integrationName: string): string {
  return `mcp__${AGENT_INTEGRATION_MCP_SERVER_NAME}__${integrationName}`;
}

function catalogFailureForSession(failure: ClaudeToolCatalogFailure): AgentSessionCatalogFailure {
  return {
    server: failure.server,
    errorClass: failure.errorClass,
    ...(failure.errorStatus === undefined ? {} : {status: failure.errorStatus}),
  };
}

function structuredClaudeToolResult(content: unknown): unknown {
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.structuredContent !== undefined) return block.structuredContent;
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (isRecord(parsed) && ('code' in parsed || 'reason' in parsed)) return parsed;
    } catch {
      // Ordinary provider text is intentionally excluded from diagnostics.
    }
  }
  return undefined;
}

function isInitMessage(message: unknown): message is Record<string, unknown> {
  return isRecord(message) && message.type === 'system' && message.subtype === 'init';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function boundedStrings(values: readonly string[]): string[] {
  return uniqueStrings(values).slice(0, MAX_DIAGNOSTIC_ENTRIES).map(truncate);
}

function truncate(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_STRING_LENGTH
    ? value
    : value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH);
}

function safeLog(fields: Record<string, unknown>, message: string): void {
  try {
    logger().info(fields, message);
  } catch {
    // Diagnostics must not affect the harness outcome.
  }
}
