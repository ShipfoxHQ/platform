import {logger} from '@shipfox/node-opentelemetry';
import type {AgentInvocationFailurePhase} from '#core/errors.js';
import type {HarnessInvocation, RequestedIntegrationTool} from '#core/harness.js';

export type ClaudeToolOmissionReason =
  | 'catalog_resolution'
  | 'runner_capability'
  | 'allowlist'
  | 'connection_policy'
  | 'sdk_registration';

export type ClaudeToolOutputGate = 'not_required' | 'passed' | 'failed' | 'not_evaluated';

export interface ClaudeToolOmission {
  readonly toolName: string;
  readonly reason: ClaudeToolOmissionReason;
}

interface ClaudeToolDiagnosticsParams {
  readonly invocation: Pick<HarnessInvocation, 'jobExecutionId' | 'stepId' | 'attempt'>;
  readonly requestedTools: readonly RequestedIntegrationTool[];
  readonly resolvedToolNames: readonly string[];
  readonly expectedSdkToolNames: readonly string[];
  readonly sdkToolToIntegrationTool: ReadonlyMap<string, string>;
  readonly selectedToolNames: readonly string[] | undefined;
  readonly omissions: readonly ClaudeToolOmission[];
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
  readonly #omissions = new Map<string, ClaudeToolOmissionReason>();
  readonly #requiredOutputCount: number;
  readonly #advertisedToolNames = new Set<string>();
  readonly #advertisedSdkToolNames = new Set<string>();
  readonly #attemptedToolNames = new Set<string>();
  readonly #failedToolNames = new Set<string>();
  readonly #toolUseIds = new Map<string, string>();
  #advertisementObserved = false;
  #sdkToolListObserved = false;
  #outcomeLogged = false;
  #failurePhase: AgentInvocationFailurePhase | undefined;

  constructor(params: ClaudeToolDiagnosticsParams) {
    this.#jobExecutionId = params.invocation.jobExecutionId ?? 'unknown';
    this.#stepId = params.invocation.stepId ?? 'unknown';
    this.#attempt = params.invocation.attempt ?? 0;
    this.#requestedToolNames = uniqueStrings(
      params.requestedTools.map((tool) => integrationToolName(tool)),
    );
    this.#resolvedToolNames = uniqueStrings(params.resolvedToolNames);
    this.#expectedSdkToolNames = new Set(params.expectedSdkToolNames);
    this.#requestedSdkToolNames = new Set(
      this.#requestedToolNames.map((name) => claudeSdkToolName(name)),
    );
    this.#sdkToolToIntegrationTool = params.sdkToolToIntegrationTool;
    this.#selectedToolNames = params.selectedToolNames;
    this.#requiredOutputCount = params.requiredOutputCount;
    for (const omission of params.omissions) this.#addOmission(omission.toolName, omission.reason);
  }

  get failurePhase(): AgentInvocationFailurePhase | undefined {
    return this.#failurePhase;
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
        omissions: this.#omissionEntries(),
      },
      'Claude integration tool manifest',
    );
  }

  recordMessage(message: unknown): void {
    if (isInitMessage(message)) {
      this.#recordInit(message);
      return;
    }
    if (!isRecord(message)) return;

    if (message.type === 'tool_progress') {
      this.#recordToolUse(message.tool_name, message.tool_use_id);
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
  }): AgentInvocationFailurePhase | undefined {
    if (this.#outcomeLogged) return this.#failurePhase;
    this.#outcomeLogged = true;
    if (params.executionFailed !== true && !this.#sdkToolListObserved) {
      this.#recordSdkRegistrationOmissions();
    }
    this.#failurePhase = this.#classify(params);
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
        omissions: this.#omissionEntries(),
      },
      'Claude integration tool outcome',
    );
    return this.#failurePhase;
  }

  #recordInit(message: Record<string, unknown>): void {
    this.#advertisementObserved = true;
    if (!Array.isArray(message.tools)) return;
    this.#sdkToolListObserved = true;
    const advertised = new Set(
      message.tools.filter((tool): tool is string => typeof tool === 'string'),
    );
    for (const toolName of this.#expectedSdkToolNames) {
      const integrationName = this.#sdkToolToIntegrationTool.get(toolName);
      if (integrationName === undefined) continue;
      if (advertised.has(toolName)) {
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
      this.#recordToolUse(block.name, block.id);
    }
  }

  #recordToolResults(message: unknown): void {
    if (!isRecord(message) || !Array.isArray(message.content)) return;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_result' || block.is_error !== true) continue;
      if (typeof block.tool_use_id !== 'string') continue;
      const toolName = this.#toolUseIds.get(block.tool_use_id);
      if (toolName !== undefined) this.#failedToolNames.add(toolName);
    }
  }

  #recordToolUse(name: unknown, toolUseId: unknown): void {
    if (typeof name !== 'string' || !this.#expectedSdkToolNames.has(name)) return;
    const integrationName = this.#sdkToolToIntegrationTool.get(name);
    if (integrationName === undefined) return;
    this.#attemptedToolNames.add(integrationName);
    if (typeof toolUseId === 'string') this.#toolUseIds.set(toolUseId, integrationName);
  }

  #classify(params: {
    outputGate: ClaudeToolOutputGate;
    executionFailed?: boolean;
  }): AgentInvocationFailurePhase | undefined {
    if (params.outputGate === 'failed') return 'output_gate_failed';
    if (this.#omissions.size > 0) return 'requested_tool_omitted';
    if (this.#failedToolNames.size > 0) return 'integration_tool_invocation_failed';
    if (params.executionFailed === true && this.#attemptedToolNames.size > 0) {
      return 'integration_tool_invocation_failed';
    }
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

export function integrationToolName(tool: RequestedIntegrationTool): string {
  return `${sanitizeSlug(tool.connectionSlug)}__${tool.toolId}`;
}

export function claudeSdkToolName(integrationName: string): string {
  return `mcp__shipfox_integration_tools__${integrationName}`;
}

function sanitizeSlug(slug: string): string {
  return slug.replaceAll('-', '_');
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
